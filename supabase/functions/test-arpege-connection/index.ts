import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Hawk authentication helpers ──

function generateNonce(length = 6): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

async function hmacSha256(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

async function sha256(data: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(hash)));
}

async function buildHawkHeader(
  url: string, method: string, id: string, key: string,
  contentType = "", payload = "",
): Promise<string> {
  const ts = Math.floor(Date.now() / 1000).toString();
  const nonce = generateNonce();
  const u = new URL(url);
  const resource = u.pathname + u.search;
  const port = u.port || (u.protocol === "https:" ? "443" : "80");
  const payloadHashInput = `hawk.1.payload\n${contentType}\n${payload}\n`;
  const hash = await sha256(payloadHashInput);
  const normalized = `hawk.1.header\n${ts}\n${nonce}\n${method.toUpperCase()}\n${resource}\n${u.hostname}\n${port}\n${hash}\n\n`;
  const mac = await hmacSha256(key, normalized);
  return `Hawk id="${id}", ts="${ts}", nonce="${nonce}", hash="${hash}", mac="${mac}"`;
}

function resolveArpegeUrl(apiBaseUrl: string): string {
  let base = apiBaseUrl.replace(/\/+$/, "");
  if (!base.startsWith("http")) {
    base = `https://www.espace-citoyens.net${base.startsWith("/") ? "" : "/"}${base}`;
  }
  return base;
}

// ── Main handler ──

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ status: "error", message: "Non autorisé" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authErr } = await callerClient.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ status: "error", message: "Non autorisé" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check admin via users table + organization_users
    const { data: userProfile } = await supabaseAdmin.from("users").select("is_superadmin").eq("id", user.id).single();
    const isSuperAdmin = userProfile?.is_superadmin === true;

    const { organization_id } = await req.json();
    if (!organization_id) {
      return new Response(
        JSON.stringify({ status: "error", message: "organization_id requis" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify caller is admin of the SPECIFIC organization being targeted
    if (!isSuperAdmin) {
      const { data: targetOrgUser } = await supabaseAdmin
        .from("organization_users")
        .select("role")
        .eq("user_id", user.id)
        .eq("organization_id", organization_id)
        .maybeSingle();
      const isOrgAdmin = targetOrgUser?.role === "admin" || targetOrgUser?.role === "administrateur";
      if (!isOrgAdmin) {
        return new Response(JSON.stringify({ status: "error", message: "Accès refusé" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const { data: integration, error } = await supabaseAdmin
      .from("organization_integrations")
      .select("api_base_url, access_token, client_id, client_secret")
      .eq("organization_id", organization_id)
      .eq("provider", "arpege")
      .eq("is_active", true)
      .maybeSingle();

    if (error) throw error;

    if (!integration || !integration.api_base_url) {
      return new Response(
        JSON.stringify({ status: "error", message: "Aucune intégration Arpège active configurée pour cette organisation" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const hawkId = integration.client_id || integration.access_token || "";
    const hawkKey = integration.client_secret || integration.access_token || "";

    if (!hawkId || !hawkKey) {
      return new Response(
        JSON.stringify({ status: "error", message: "Identifiants Hawk manquants (client_id / client_secret ou access_token)" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const baseUrl = resolveArpegeUrl(integration.api_base_url);
    const url = `${baseUrl}/v2/Hello`;
    console.log(`Testing Arpège connection (Hawk): ${url}`);

    const hawkAuthHeader = await buildHawkHeader(url, "GET", hawkId, hawkKey);

    const apiResponse = await fetch(url, {
      headers: {
        Authorization: hawkAuthHeader,
        Accept: "application/json",
      },
    });

    const responseText = await apiResponse.text();
    console.log(`Arpège response: HTTP ${apiResponse.status}, body: ${responseText.substring(0, 500)}`);

    if (!apiResponse.ok) {
      return new Response(
        JSON.stringify({ status: "error", message: `HTTP ${apiResponse.status}: ${responseText.substring(0, 200)}` }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let data: any;
    try { data = JSON.parse(responseText); } catch { data = {}; }

    if (data?.IsSuccess === false) {
      return new Response(
        JSON.stringify({ status: "error", message: `${data.CodErreur}: ${data.LibErreur}` }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ status: "success", message: "Connexion réussie avec l'API Arpège (Hawk)" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("test-arpege-connection error:", err);
    return new Response(
      JSON.stringify({ status: "error", message: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
