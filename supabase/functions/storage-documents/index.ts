import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-org-id",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const BUCKET = "clara-documents";

function getAdminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function verifyAuth(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) throw new Error("Missing authorization header");

  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const anonClient = createClient(url, anonKey, { auth: { persistSession: false } });

  const token = authHeader.replace("Bearer ", "");
  const { data, error } = await anonClient.auth.getUser(token);
  if (error || !data.user) throw new Error("Unauthorized");
  return data.user;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const user = await verifyAuth(req);
    const admin = getAdminClient();
    const url = new URL(req.url);
    const action = url.searchParams.get("action");
    const orgId = req.headers.get("x-org-id");

    if (!orgId) return jsonResponse({ error: "Missing x-org-id header" }, 400);

    // All paths are prefixed with org id for isolation
    const pathPrefix = `${orgId}/`;

    if (req.method === "POST" && action === "upload") {
      const formData = await req.formData();
      const file = formData.get("file") as File | null;
      const filePath = formData.get("path") as string | null;

      if (!file || !filePath) {
        return jsonResponse({ error: "Missing file or path" }, 400);
      }

      const fullPath = `${pathPrefix}${filePath}`;
      const arrayBuffer = await file.arrayBuffer();

      const { data, error } = await admin.storage
        .from(BUCKET)
        .upload(fullPath, arrayBuffer, {
          contentType: file.type,
          upsert: true,
        });

      if (error) return jsonResponse({ error: error.message }, 500);

      return jsonResponse({
        storage_key: data.path,
        file_name: file.name,
        mime_type: file.type,
        file_size: file.size,
      });
    }

    if (req.method === "GET" && action === "download") {
      const filePath = url.searchParams.get("path");
      if (!filePath) return jsonResponse({ error: "Missing path" }, 400);

      // Ensure path belongs to org
      if (!filePath.startsWith(pathPrefix)) {
        return jsonResponse({ error: "Access denied" }, 403);
      }

      const { data, error } = await admin.storage
        .from(BUCKET)
        .createSignedUrl(filePath, 60); // 60s signed URL

      if (error) return jsonResponse({ error: error.message }, 500);
      return jsonResponse({ url: data.signedUrl });
    }

    if (req.method === "DELETE" && action === "delete") {
      const body = await req.json();
      const filePath = body.path as string;
      if (!filePath) return jsonResponse({ error: "Missing path" }, 400);

      if (!filePath.startsWith(pathPrefix)) {
        return jsonResponse({ error: "Access denied" }, 403);
      }

      const { error } = await admin.storage.from(BUCKET).remove([filePath]);
      if (error) return jsonResponse({ error: error.message }, 500);

      return jsonResponse({ success: true });
    }

    return jsonResponse({ error: "Unknown action" }, 400);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    const status = message === "Unauthorized" ? 401 : 500;
    return jsonResponse({ error: message }, status);
  }
});
