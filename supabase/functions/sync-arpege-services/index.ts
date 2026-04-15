import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Hawk authentication ──

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
): Promise<string> {
  const ts = Math.floor(Date.now() / 1000).toString();
  const nonce = generateNonce();
  const u = new URL(url);
  const resource = u.pathname + u.search;
  const port = u.port || (u.protocol === "https:" ? "443" : "80");
  const hash = await sha256(`hawk.1.payload\n\n\n`);
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

async function fetchWithHawk(url: string, hawkId: string, hawkKey: string): Promise<any | null> {
  const authHeader = await buildHawkHeader(url, "GET", hawkId, hawkKey);
  const response = await fetch(url, {
    headers: { Authorization: authHeader, Accept: "application/json" },
  });
  if (!response.ok) {
    console.warn(`HTTP ${response.status} for ${url}`);
    return null;
  }
  const data = await response.json();
  if (data?.IsSuccess === false) {
    console.warn(`API error: ${data.CodErreur} - ${data.LibErreur}`);
    return null;
  }
  return data;
}

function extractArray(data: any): any[] {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.Data?.Results)) return data.Data.Results;
  if (Array.isArray(data?.Data?.results)) return data.Data.results;
  if (Array.isArray(data?.Data)) return data.Data;
  for (const key of Object.keys(data || {})) {
    if (Array.isArray(data[key]) && data[key].length > 0) return data[key];
  }
  return [];
}

// ── Auth helper ──

async function checkAuth(req: Request, supabaseAdmin: any, supabaseUrl: string, anonKey: string): Promise<boolean> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return false;
  const token = authHeader.replace("Bearer ", "").trim();

  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if (token === serviceRoleKey) return true;

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error } = await callerClient.auth.getUser();
  if (error || !user) return false;

  const { data: userProfile } = await supabaseAdmin.from("users").select("is_superadmin").eq("id", user.id).single();
  if (userProfile?.is_superadmin) return true;

  const { data: orgUser } = await supabaseAdmin.from("organization_users").select("role").eq("user_id", user.id).limit(1).maybeSingle();
  return orgUser?.role === "admin";
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
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    const isAuthorized = await checkAuth(req, supabaseAdmin, supabaseUrl, anonKey);
    if (!isAuthorized) {
      return new Response(JSON.stringify({ error: "Non autorisé" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const filterOrgId = body.organization_id || null;

    let query = supabaseAdmin
      .from("organization_integrations")
      .select("*")
      .eq("provider", "arpege")
      .eq("is_active", true);
    if (filterOrgId) query = query.eq("organization_id", filterOrgId);

    const { data: integrations, error: intError } = await query;
    if (intError) throw intError;

    if (!integrations?.length) {
      return new Response(
        JSON.stringify({ message: "No active Arpège integrations", total: 0, created: 0, updated: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let totalCreated = 0;
    let totalUpdated = 0;

    for (const integration of integrations) {
      const { organization_id } = integration;
      if (!integration.api_base_url) continue;

      const apiBase = resolveArpegeUrl(integration.api_base_url);
      const hawkId = integration.client_id || integration.access_token || "";
      const hawkKey = integration.client_secret || integration.access_token || "";
      if (!hawkId || !hawkKey) continue;

      // Try /v2/TypesDemandes
      let typesDemandes: any[] = [];
      const tdData = await fetchWithHawk(`${apiBase}/v2/TypesDemandes`, hawkId, hawkKey);
      if (tdData) typesDemandes = extractArray(tdData);

      // Fallback: extract from /v2/Demandes
      if (typesDemandes.length === 0) {
        const demandesData = await fetchWithHawk(`${apiBase}/v2/Demandes?pageSize=200`, hawkId, hawkKey);
        if (demandesData) {
          const demandes = extractArray(demandesData);
          const typesMap = new Map<string, any>();
          for (const d of demandes) {
            const typeId = String(d.IdTypeDemande || d.TypeDemande?.Id || "");
            const typeName = d.LibelleTypeDemande || d.TypeDemande?.Libelle || d.TypeDemarche || "";
            if (typeId && typeName && !typesMap.has(typeId)) {
              typesMap.set(typeId, { IdTypeDemande: typeId, Libelle: typeName });
            }
          }
          typesDemandes = Array.from(typesMap.values());
        }
      }

      if (typesDemandes.length === 0) continue;

      // Filter: only published
      const published = typesDemandes.filter((td: any) => {
        const etat = td.TypeEtatPublication || td.typeEtatPublication || "";
        return etat === "ENLIGNE";
      });

      console.log(`Org ${organization_id}: ${published.length}/${typesDemandes.length} published services`);

      for (const td of published) {
        const externalRef = String(td.CodeQualificationTypeDemande || td.IdTypeDemande || td.Id || "");
        const name = td.LibelleQualificationTypeDemande || td.Libelle || td.Label || td.Nom || "";
        if (!externalRef || !name) continue;

        // Log for now — actual storage will depend on Clara's service/workflow model
        console.log(`Service: ${name} (ref=${externalRef})`);
        totalCreated++;
      }
    }

    console.log(`Sync done: ${totalCreated} services found`);

    return new Response(
      JSON.stringify({ message: "Synchronisation terminée", total: totalCreated, created: totalCreated, updated: totalUpdated }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("sync-arpege-services error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
