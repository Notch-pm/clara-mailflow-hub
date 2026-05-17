import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-org-id, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
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

type AuthContext = { authorized: boolean; isPrivileged: boolean; userId?: string };

async function checkAuth(req: Request, supabaseAdmin: any, supabaseUrl: string, anonKey: string): Promise<AuthContext> {
  // 1) Cron secret header — privileged
  const providedCronSecret = req.headers.get("x-cron-secret");
  if (providedCronSecret) {
    try {
      const { data: vaultSecret, error: rpcErr } = await supabaseAdmin.rpc("get_cron_secret");
      if (!rpcErr && vaultSecret && providedCronSecret === vaultSecret) {
        return { authorized: true, isPrivileged: true };
      }
      if (rpcErr) console.error("get_cron_secret RPC error:", rpcErr.message);
    } catch (e) {
      console.error("get_cron_secret exception:", e);
    }
  }

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
    let filterOrgId = body.organization_id || null;
    const runInBackground = body.background !== false; // default true

    // Non-privileged users must operate on their own org only
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

    // Long-running work — execute in the background and return immediately
    // so the client (browser) does not hit a network timeout.
    const work = runSync(supabaseAdmin, integrations);

    if (runInBackground) {
      // @ts-ignore Deno edge runtime
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
        // @ts-ignore
        EdgeRuntime.waitUntil(work);
      } else {
        work.catch((e) => console.error("background sync error:", e));
      }
      return new Response(
        JSON.stringify({
          message: "Synchronisation lancée en arrière-plan",
          organizations: integrations.length,
        }),
        { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const result = await work;
    return new Response(
      JSON.stringify({ message: "Synchronisation terminée", ...result }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("sync-arpege-services error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function runSync(supabaseAdmin: any, integrations: any[]) {
    let totalCreated = 0;
    let totalUpdated = 0;
    let totalSkipped = 0;

    for (const integration of integrations) {
      const { organization_id } = integration;
      if (!integration.api_base_url) continue;

      const apiBase = resolveArpegeUrl(integration.api_base_url);
      const hawkId = integration.client_id || integration.access_token || "";
      const hawkKey = integration.client_secret || integration.access_token || "";
      if (!hawkId || !hawkKey) continue;

      // Récupérer les schémas de formulaire depuis les demandes existantes (une par type)
      const formSchemaByType = new Map<string, any[]>();
      const formData = await fetchWithHawk(
        `${apiBase}/v2/Demandes?scope=data_formulaire,data_administratives&TypeDemarches=DEMANDE&pageSize=200`,
        hawkId, hawkKey,
      );
      if (formData) {
        for (const item of extractArray(formData)) {
          const typeCode = item.data_administratives?.CodeQualificationTypeDemande;
          const components = item.data_formulaire?.Components;
          if (typeCode && Array.isArray(components) && !formSchemaByType.has(typeCode)) {
            formSchemaByType.set(typeCode, components);
          }
        }
      }
      console.log(`Org ${organization_id}: form schemas retrieved for ${formSchemaByType.size} types`);

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
        return etat === "ENLIGNE" || etat === ""; // accept empty (some endpoints don't return this)
      });

      console.log(`Org ${organization_id}: ${published.length}/${typesDemandes.length} published démarches`);

      for (const td of published) {
        const externalRef = String(
          td.CodeQualificationTypeDemande || td.IdTypeDemande || td.Id || "",
        );
        const name =
          td.LibelleQualificationTypeDemande || td.Libelle || td.Label || td.Nom || "";
        if (!externalRef || !name) continue;

        const description = td.Description || td.description || null;
        const vignetteUrl =
          td.UrlVignetteQualificationTypeDemande || td.UrlVignette || null;

        // Config formulaire : champs demandeur + code métier + formulaire métier
        const arpegeConfigFields = {
          CodeQualificationMetier: td.CodeQualificationMetier || null,
          ConfigInfoUsagerObligs: (td.ConfigInfoUsagerObligs || []).filter(
            (f: any) => f.Etat === "ENLIGNE",
          ),
          FormComponents: formSchemaByType.get(externalRef) ?? null,
        };

        const { data: existing } = await supabaseAdmin
          .from("procedures")
          .select("id, name, description, icon, arpege_config_fields")
          .eq("organization_id", organization_id)
          .eq("external_source", "arpege")
          .eq("external_reference_id", externalRef)
          .maybeSingle();

        if (existing) {
          const nameChanged = existing.name !== name;
          const descChanged = (existing.description || null) !== (description || null);
          const shouldUpdateIcon = vignetteUrl && existing.icon !== vignetteUrl;
          const configChanged =
            JSON.stringify(existing.arpege_config_fields) !== JSON.stringify(arpegeConfigFields);

          if (nameChanged || descChanged || shouldUpdateIcon || configChanged) {
            const updateData: Record<string, unknown> = { name, description, arpege_config_fields: arpegeConfigFields };
            if (shouldUpdateIcon) updateData.icon = vignetteUrl;
            const { error: updErr } = await supabaseAdmin
              .from("procedures")
              .update(updateData)
              .eq("id", existing.id);
            if (updErr) {
              console.error(`Update failed for "${name}": ${updErr.message}`);
              continue;
            }
            totalUpdated++;
          } else {
            totalSkipped++;
          }
        } else {
          const { error: insertErr } = await supabaseAdmin.from("procedures").insert({
            organization_id,
            name,
            description,
            icon: vignetteUrl || null,
            external_reference_id: externalRef,
            external_source: "arpege",
            is_displayed: true,
            arpege_config_fields: arpegeConfigFields,
          });
          if (insertErr) {
            console.error(`Insert failed for "${name}": ${insertErr.message}`);
            continue;
          }
          totalCreated++;
        }
      }
    }

  console.log(`Sync done: ${totalCreated} created, ${totalUpdated} updated, ${totalSkipped} unchanged`);

  return {
    total: totalCreated + totalUpdated + totalSkipped,
    created: totalCreated,
    updated: totalUpdated,
    skipped: totalSkipped,
  };
}

