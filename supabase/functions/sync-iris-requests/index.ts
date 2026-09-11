// Réconciliation nocturne des demandes déposées dans Iris.
//
// Une fois déposée, la demande est instruite DANS Iris : Clara en suit l'état,
// elle ne la pilote pas. Ce suivi est une réconciliation SYSTÈME (écriture
// service_role, idempotente, non attribuable à un utilisateur) — un consultant
// voit donc un statut à jour sans déclencher d'écriture qui lui soit imputable.
//
// Chemin prévu par le contrat : `GET /v1/requests?updated_since=` (tri
// `updated_at` croissant), puis garde sur la version MONOTONE : une mise à jour
// n'est appliquée que si elle dépasse celle déjà connue, ce qui absorbe rejeux
// et arrivées en désordre.
//
// Auth (3 voies, comme sync-socle-referentiel) : x-cron-secret, service role,
// ou JWT superadmin. Body : { organization_id? }.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  irisErrorMessage,
  irisRequestsFromBody,
  irisTicketPatch,
  shouldApplyIrisUpdate,
} from "../_shared/iris-envelope.ts";
import { listIrisRequests, resolveIrisIntegration } from "../_shared/iris.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-org-id, x-cron-secret, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const PAGE_SIZE = 500;
/** Garde-fou : une pagination qui ne progresse pas ne doit pas tourner sans fin. */
const MAX_PAGES = 20;

type AdminClient = ReturnType<typeof createClient>;

interface OrgCounters {
  organization_id: string;
  organization_name: string;
  examinees: number;
  mises_a_jour: number;
  ignorees_version: number;
  inconnues: number;
  warnings?: string[];
}

async function syncOrg(
  supabaseAdmin: AdminClient,
  org: { id: string; name: string },
): Promise<OrgCounters | null> {
  // Pas d'interface exploitable (aucune, ou sans adresse/clé) : rien à
  // réconcilier. Une interface SUSPENDUE est en revanche relue : la suspension
  // coupe le nouveau trafic, pas le suivi — une clôture côté Iris ne doit
  // jamais être perdue (docs/partenaires-integration.md §5).
  const { integration } = await resolveIrisIntegration(supabaseAdmin, org.id);
  if (!integration) return null;

  const counters: OrgCounters = {
    organization_id: org.id,
    organization_name: org.name,
    examinees: 0,
    mises_a_jour: 0,
    ignorees_version: 0,
    inconnues: 0,
  };
  const warnings: string[] = [];

  const { data: integrationRow } = await supabaseAdmin
    .from("organization_integrations")
    .select("last_sync_at")
    .eq("organization_id", org.id)
    .eq("provider", "iris")
    .maybeSingle();

  let cursor: string | null = integrationRow?.last_sync_at ?? null;
  let latest: string | null = cursor;

  for (let page = 0; page < MAX_PAGES; page++) {
    const { status, body } = await listIrisRequests(integration, cursor, PAGE_SIZE);
    // Iris enveloppe sa liste : { requests: [...] }.
    const items = status === 200 ? irisRequestsFromBody(body) : null;
    if (!items) {
      warnings.push(irisErrorMessage(status, body));
      break;
    }
    if (items.length === 0) break;

    for (const item of items) {
      counters.examinees++;
      const externalId = (item.external_id ?? "").trim();
      const updatedAt = (item.updated_at ?? "").trim();
      if (updatedAt && (!latest || updatedAt > latest)) latest = updatedAt;
      if (!externalId) {
        // Demande née ailleurs que dans Clara (portail, guichet…) : pas la nôtre.
        counters.inconnues++;
        continue;
      }

      const version = typeof item.version === "number" ? item.version : null;
      // Garde de version appliquée EN BASE : la ligne n'est touchée que si la
      // version reçue dépasse celle connue — pas de lecture préalable, donc pas
      // de fenêtre entre le test et l'écriture.
      let query = supabaseAdmin
        .from("action_tickets")
        .update(irisTicketPatch(item, new Date().toISOString()))
        .eq("id", externalId)
        .eq("organization_id", org.id);
      if (version !== null) {
        query = query.or(`iris_version.is.null,iris_version.lt.${version}`);
      }
      const { data: updated, error } = await query.select("id, iris_version");

      if (error) {
        // Un external_id qui n'est pas un uuid (source tierce) casse le filtre :
        // ce n'est pas une panne, c'est une demande qui ne nous concerne pas.
        counters.inconnues++;
        continue;
      }
      if (!updated || updated.length === 0) {
        // Soit le ticket n'existe pas ici, soit la version connue est plus
        // récente. On distingue pour que les compteurs disent la vérité.
        const { data: exists } = await supabaseAdmin
          .from("action_tickets")
          .select("id, iris_version")
          .eq("id", externalId)
          .eq("organization_id", org.id)
          .maybeSingle();
        if (!exists) counters.inconnues++;
        else if (!shouldApplyIrisUpdate(exists.iris_version, version)) counters.ignorees_version++;
        continue;
      }
      counters.mises_a_jour++;
    }

    if (items.length < PAGE_SIZE) break;
    if (!latest || latest === cursor) break; // pagination qui n'avance plus
    cursor = latest;
  }

  if (latest && latest !== integrationRow?.last_sync_at) {
    await supabaseAdmin
      .from("organization_integrations")
      .update({ last_sync_at: latest })
      .eq("organization_id", org.id)
      .eq("provider", "iris");
  }

  if (warnings.length > 0) counters.warnings = warnings;
  return counters;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const json = (payload: unknown, status = 200) =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    // ── Auth : cron, service role, ou superadmin ──
    let authorized = false;
    const cronSecret = req.headers.get("x-cron-secret");
    if (cronSecret) {
      const { data: vaultSecret } = await supabaseAdmin.rpc("get_cron_secret");
      if (vaultSecret && cronSecret === vaultSecret) authorized = true;
    }
    const authHeader = req.headers.get("Authorization");
    if (!authorized && authHeader) {
      const token = authHeader.replace("Bearer ", "").trim();
      if (token === serviceRoleKey) {
        authorized = true;
      } else {
        const callerClient = createClient(supabaseUrl, anonKey, {
          global: { headers: { Authorization: authHeader } },
        });
        const { data: { user } } = await callerClient.auth.getUser();
        if (user) {
          const { data: profile } = await supabaseAdmin
            .from("users").select("is_superadmin").eq("id", user.id).single();
          if (profile?.is_superadmin) authorized = true;
        }
      }
    }
    if (!authorized) return json({ error: "Non autorisé" }, 401);

    const body = await req.json().catch(() => ({}));
    const filterOrgId: string | null = body.organization_id ?? null;

    let query = supabaseAdmin.from("organizations").select("id, name");
    if (filterOrgId) query = query.eq("id", filterOrgId);
    const { data: orgs, error: orgsError } = await query;
    if (orgsError) throw orgsError;

    const results: OrgCounters[] = [];
    for (const org of orgs ?? []) {
      const counters = await syncOrg(supabaseAdmin, org);
      if (counters) {
        results.push(counters);
        console.log(
          `[iris] ${org.name}: ${counters.examinees} demande(s) examinée(s), ${counters.mises_a_jour} mise(s) à jour, ${counters.ignorees_version} ignorée(s) (version), ${counters.inconnues} hors Clara`,
        );
      }
    }

    return json({
      message: results.length === 0
        ? "Aucune organisation avec une interface Iris active"
        : "Réconciliation terminée",
      results,
    });
  } catch (error) {
    console.error("[iris] sync-iris-requests:", error);
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
