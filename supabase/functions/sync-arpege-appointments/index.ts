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

function mapArpegeStatus(codeEtat: string | null | undefined): string {
  if (!codeEtat) return "scheduled";
  const normalized = codeEtat.toLowerCase();
  if (normalized === "planifie" || normalized === "planifié") return "scheduled";
  if (normalized === "confirme" || normalized === "confirmé") return "confirmed";
  if (normalized === "realise" || normalized === "réalisé") return "completed";
  if (normalized === "annule" || normalized === "annulé") return "cancelled";
  if (normalized === "absent" || normalized === "noshow") return "no_show";
  return "scheduled";
}

// ── Auth helper ──

type AuthContext = { authorized: boolean; isPrivileged: boolean; userId?: string };

async function checkAuth(req: Request, supabaseAdmin: any, supabaseUrl: string, anonKey: string): Promise<AuthContext> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return { authorized: false, isPrivileged: false };
  const token = authHeader.replace("Bearer ", "").trim();

  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if (token === serviceRoleKey) return { authorized: true, isPrivileged: true };

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error } = await callerClient.auth.getUser();
  if (error || !user) return { authorized: false, isPrivileged: false };

  const { data: userProfile } = await supabaseAdmin.from("users").select("is_superadmin").eq("id", user.id).single();
  if (userProfile?.is_superadmin) return { authorized: true, isPrivileged: true, userId: user.id };

  return { authorized: true, isPrivileged: false, userId: user.id };
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

    const auth = await checkAuth(req, supabaseAdmin, supabaseUrl, anonKey);
    if (!auth.authorized) {
      return new Response(JSON.stringify({ error: "Non autorisé" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const filterOrgId = body.organization_id || null;

    if (!auth.isPrivileged) {
      if (!filterOrgId) {
        return new Response(JSON.stringify({ error: "organization_id requis" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: targetOrgUser } = await supabaseAdmin
        .from("organization_users")
        .select("role")
        .eq("user_id", auth.userId)
        .eq("organization_id", filterOrgId)
        .maybeSingle();
      const isOrgAdmin = targetOrgUser?.role === "admin" || targetOrgUser?.role === "administrateur";
      if (!isOrgAdmin) {
        return new Response(JSON.stringify({ error: "Accès refusé" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Build date range: today → +6 months
    const today = new Date();
    const sixMonths = new Date(today);
    sixMonths.setMonth(sixMonths.getMonth() + 6);
    const dateDebut = today.toISOString().split("T")[0];
    const dateFin = sixMonths.toISOString().split("T")[0];

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
        JSON.stringify({ message: "No active Arpège integrations", synced: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let totalSynced = 0;

    for (const integration of integrations) {
      const { organization_id } = integration;
      if (!integration.api_base_url) continue;

      const apiBase = resolveArpegeUrl(integration.api_base_url);
      const hawkId = integration.client_id || integration.access_token || "";
      const hawkKey = integration.client_secret || integration.access_token || "";
      if (!hawkId || !hawkKey) continue;

      console.log(`Org ${organization_id}: starting sync, apiBase=${apiBase}`);

      const url = `${apiBase}/v2/Demandes?TypeDemarches=RENDEZVOUS&scope=data_rendezvous,data_demandeur,data_administratives&pageSize=100&DateDebutRdv=${dateDebut}&DateFinRdv=${dateFin}`;
      const data = await fetchWithHawk(url, hawkId, hawkKey);
      if (!data) continue;

      const demandes = extractArray(data);
      console.log(`Org ${organization_id}: ${demandes.length} RDV fetched`);

      for (const demande of demandes) {
        const rdv = demande.data_rendezvous || demande.DataRendezVous || {};
        const demandeur = demande.data_demandeur || demande.DataDemandeur || {};

        const externalRef = demande.ticket || rdv.Reference || rdv.ReferenceRendezVous;
        if (!externalRef) continue;

        const scheduledTime = rdv.DateHeurePrevueDebut || rdv.DateHeurePrevueFin || rdv.DateHeureRendezVous;
        if (!scheduledTime) continue;

        const contact = demandeur.Contact || {};
        const citizenLastName = demandeur.NomUsage || demandeur.NomNaissance || demandeur.Nom || null;
        const citizenFirstName = demandeur.Prenoms || demandeur.Prenom || null;
        const citizenName = demandeur.PrenomNomUsuels || demandeur.NomComplet
          || ((citizenFirstName && citizenLastName) ? `${citizenFirstName} ${citizenLastName}` : null)
          || citizenLastName || citizenFirstName || null;
        const citizenEmail = contact.LibEmail || demandeur.Email || null;
        const phone = contact.LibNumMob || contact.LibNumTel || demandeur.Telephone || null;

        const arpegeStatus = rdv.code_etat || rdv.CodeEtat || null;
        const mappedStatus = mapArpegeStatus(arpegeStatus);

        // Store in courier_events as Arpège sync data (or a dedicated table later)
        console.log(`Synced: ${externalRef} (${citizenName}, ${scheduledTime}, status=${mappedStatus})`);
        totalSynced++;
      }
    }

    console.log(`Sync completed: ${totalSynced} appointments synced`);

    return new Response(
      JSON.stringify({ message: "Sync completed", synced: totalSynced }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("sync-arpege-appointments error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
