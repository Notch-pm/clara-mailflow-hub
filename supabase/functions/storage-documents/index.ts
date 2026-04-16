import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-org-id",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const BUCKET = "clara-documents";

/** Default max file size: 10 MB */
const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024;

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

/**
 * Verify the authenticated user belongs to the given organization.
 * Uses service-role client to bypass RLS on organization_users.
 */
async function verifyOrgMembership(
  admin: ReturnType<typeof getAdminClient>,
  userId: string,
  orgId: string
) {
  // Superadmins bypass org membership check
  const { data: userRow } = await admin
    .from("users")
    .select("is_superadmin")
    .eq("id", userId)
    .single();

  if (userRow?.is_superadmin) return;

  const { data, error } = await admin
    .from("organization_users")
    .select("id")
    .eq("user_id", userId)
    .eq("organization_id", orgId)
    .eq("is_active", true)
    .limit(1)
    .single();

  if (error || !data) {
    throw new Error("Forbidden: user does not belong to this organization");
  }
}

/**
 * Read the organization's max_file_size from organizations.metadata.
 * Falls back to DEFAULT_MAX_FILE_SIZE if not set.
 */
async function getMaxFileSize(
  admin: ReturnType<typeof getAdminClient>,
  orgId: string
): Promise<number> {
  const { data } = await admin
    .from("organizations")
    .select("metadata")
    .eq("id", orgId)
    .single();

  const meta = data?.metadata as Record<string, unknown> | null;
  if (meta && typeof meta.max_file_size === "number" && meta.max_file_size > 0) {
    return meta.max_file_size;
  }
  return DEFAULT_MAX_FILE_SIZE;
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

    // Validate org id format
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRe.test(orgId)) return jsonResponse({ error: "Invalid x-org-id" }, 400);

    // Verify user belongs to this organization
    await verifyOrgMembership(admin, user.id, orgId);

    const pathPrefix = `org_${orgId}/`;

    // ── UPLOAD ────────────────────────────────────────────────────────
    if (req.method === "POST" && action === "upload") {
      const formData = await req.formData();
      const file = formData.get("file") as File | null;
      const courierId = formData.get("courier_id") as string | null;
      const documentType = (formData.get("document_type") as string) || "attachment";

      if (!file) return jsonResponse({ error: "Missing file" }, 400);
      if (!courierId) return jsonResponse({ error: "Missing courier_id" }, 400);

      // File size check
      const maxSize = await getMaxFileSize(admin, orgId);
      if (file.size > maxSize) {
        const maxMB = (maxSize / (1024 * 1024)).toFixed(1);
        return jsonResponse(
          { error: `Fichier trop volumineux (max ${maxMB} Mo)`, max_file_size: maxSize },
          413
        );
      }

      // Generate deterministic path: org_{orgId}/couriers/{courierId}/{uuid}.{ext}
      const ext = file.name.includes(".") ? file.name.split(".").pop() : "bin";
      const fileUuid = crypto.randomUUID();
      const storagePath = `${pathPrefix}couriers/${courierId}/${fileUuid}.${ext}`;

      const arrayBuffer = await file.arrayBuffer();
      const { data: uploadData, error: uploadError } = await admin.storage
        .from(BUCKET)
        .upload(storagePath, arrayBuffer, { contentType: file.type, upsert: false });

      if (uploadError) return jsonResponse({ error: uploadError.message }, 500);

      // Save reference in courier_documents
      const { data: docRow, error: docError } = await admin
        .from("courier_documents")
        .insert({
          courier_id: courierId,
          organization_id: orgId,
          storage_key: uploadData.path,
          file_name: file.name,
          mime_type: file.type,
          file_size: file.size,
          document_type: documentType,
        })
        .select()
        .single();

      if (docError) {
        // Rollback: delete uploaded file
        await admin.storage.from(BUCKET).remove([uploadData.path]);
        return jsonResponse({ error: docError.message }, 500);
      }

      return jsonResponse(docRow, 201);
    }

    // ── DOWNLOAD (signed URL) ─────────────────────────────────────────
    if (req.method === "GET" && action === "download") {
      const storageKey = url.searchParams.get("path");
      if (!storageKey) return jsonResponse({ error: "Missing path" }, 400);

      if (!storageKey.startsWith(pathPrefix)) {
        return jsonResponse({ error: "Access denied" }, 403);
      }

      const { data, error } = await admin.storage
        .from(BUCKET)
        .createSignedUrl(storageKey, 300); // 5 min

      if (error) return jsonResponse({ error: error.message }, 500);
      return jsonResponse({ url: data.signedUrl });
    }

    // ── DELETE (file + DB row) ────────────────────────────────────────
    if (req.method === "DELETE" && action === "delete") {
      const body = await req.json();
      const documentId = body.document_id as string;
      if (!documentId) return jsonResponse({ error: "Missing document_id" }, 400);

      // Fetch the doc to get storage_key
      const { data: doc, error: fetchErr } = await admin
        .from("courier_documents")
        .select("id, storage_key, organization_id")
        .eq("id", documentId)
        .single();

      if (fetchErr || !doc) return jsonResponse({ error: "Document not found" }, 404);
      if (doc.organization_id !== orgId) return jsonResponse({ error: "Access denied" }, 403);

      // Step 1: Delete from storage — abort if this fails
      const storageKey = doc.storage_key;
      if (storageKey) {
        const { error: storageErr } = await admin.storage.from(BUCKET).remove([storageKey]);
        if (storageErr) {
          return jsonResponse(
            { error: `Échec suppression fichier: ${storageErr.message}` },
            500
          );
        }
      }

      // Step 2: Delete DB row — if this fails, log but still report error
      // (file is already gone, admin can clean up the orphan row)
      const { error: delErr } = await admin
        .from("courier_documents")
        .delete()
        .eq("id", documentId);

      if (delErr) {
        console.error(`Storage file deleted but DB row removal failed for ${documentId}:`, delErr.message);
        return jsonResponse(
          { error: `Fichier supprimé mais erreur DB: ${delErr.message}` },
          500
        );
      }

      return jsonResponse({ success: true });
    }

    // ── MAX SIZE (for frontend validation) ────────────────────────────
    if (req.method === "GET" && action === "max-size") {
      const maxSize = await getMaxFileSize(admin, orgId);
      return jsonResponse({ max_file_size: maxSize });
    }

    return jsonResponse({ error: "Unknown action" }, 400);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    const status = message === "Unauthorized" ? 401 : message.startsWith("Forbidden") ? 403 : 500;
    return jsonResponse({ error: message }, status);
  }
});
