import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildHawkHeader, resolveArpegeUrl, resolveHawkCredentials } from "../_shared/arpege.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-org-id, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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

    const { hawkId, hawkKey } = resolveHawkCredentials(integration);

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
