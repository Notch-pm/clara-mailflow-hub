// Synchronisation nocturne du référentiel Socle → Clara.
// Le Socle est la source de vérité des démarches : catégories, types de documents
// et démarches activées par organisation sont miroirés dans Clara (upsert idempotent
// par socle_id, soft-delete des éléments disparus). Voir logic.ts pour la logique pure.
//
// Auth (3 voies, comme sync-arpege-services) :
//   - x-cron-secret (pg_cron via trigger_socle_sync) → privilégié
//   - Bearer SERVICE_ROLE_KEY → privilégié
//   - JWT utilisateur : superadmin → privilégié ; admin d'org → restreint à son org.
//
// Body : { organization_id?: uuid, background?: boolean (défaut true), dry_run?: boolean }
// Query : ?action=list-organizations (privilégié) → relaie GET /v1/organizations du Socle
//         pour alimenter le sélecteur de mapping socle_org_id.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  catalogueForRoot,
  countersFromMirrorPlan,
  countersFromOrgPlan,
  countersFromProcedurePlan,
  filterSubtree,
  rootOrgId,
  mapSocleOrganization,
  mapSocleProcedure,
  planMirrorSync,
  planOrganizationSync,
  planProcedureSync,
  planTenantIdentityUpdate,
  type EntityCounters,
  type MirrorItem,
  type MirrorRow,
  type OrgMirrorRow,
  type ProcedureRow,
  type SocleCategory,
  type SocleDocumentType,
  type SocleOrgApi,
  type SocleProcedure,
} from "./logic.ts";

type AdminClient = ReturnType<typeof createClient>;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-org-id, x-cron-secret, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const PROCEDURE_SYNC_COLUMNS =
  "id, name, description, socle_id, is_displayed, display_order, obsoleted_at, type, keywords, user_description, agent_description, input_duration_minutes, socle_category_id, requester_config, form_schema, knowledge_base, translations";

// ── Client HTTP Socle : timeout + retries avec backoff, arrêt net sur 401 ──

class SocleAuthError extends Error {}
class SocleApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

const SOCLE_TIMEOUT_MS = 20_000;
const RETRY_DELAYS_MS = [1_000, 3_000, 9_000];

function socleBaseUrl(): string {
  return (
    Deno.env.get("SOCLE_API_URL") ??
    "https://qhrokbkyxgcvkbpmbmna.supabase.co/functions/v1/public-api"
  ).replace(/\/+$/, "");
}

async function fetchSocle(path: string): Promise<unknown> {
  // trim défensif : un espace/retour à la ligne collé au secret casserait le hash SHA-256 côté Socle
  const apiKey = Deno.env.get("SOCLE_API_KEY")?.trim();
  if (!apiKey) throw new Error("Secret SOCLE_API_KEY manquant — configurez-le dans les secrets de la fonction");
  const url = `${socleBaseUrl()}${path}`;

  let lastError: unknown = null;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt - 1]));
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SOCLE_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
        signal: controller.signal,
      });

      if (response.status === 401) {
        // Diagnostic non sensible : préfixe (déjà en clair dans api_keys.key_prefix) + longueur.
        console.error(
          `[sync-socle] 401 Socle — clé envoyée: préfixe="${apiKey.slice(0, 12)}" longueur=${apiKey.length}`,
        );
        // Clé absente/invalide/révoquée/expirée : inutile de réessayer, on arrête tout.
        throw new SocleAuthError(
          "Clé API Socle invalide ou révoquée (401) — synchronisation interrompue",
        );
      }

      if (!response.ok) {
        let message = `HTTP ${response.status}`;
        try {
          const body = await response.json();
          if (body?.error?.message) message = `${body.error.code}: ${body.error.message}`;
        } catch { /* corps non JSON */ }

        if (response.status >= 500) {
          // Erreur serveur : on retente.
          lastError = new SocleApiError(message, response.status);
          console.warn(`[sync-socle] ${path} tentative ${attempt + 1}: ${message}`);
          continue;
        }
        // Autre 4xx : erreur définitive, pas de retry.
        throw new SocleApiError(message, response.status);
      }

      return await response.json();
    } catch (e) {
      if (e instanceof SocleAuthError || e instanceof SocleApiError) throw e;
      // Erreur réseau ou timeout : on retente.
      lastError = e;
      console.warn(
        `[sync-socle] ${path} tentative ${attempt + 1} échouée: ${e instanceof Error ? e.message : e}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(
    `API Socle injoignable (${path}) après ${RETRY_DELAYS_MS.length + 1} tentatives: ${
      lastError instanceof Error ? lastError.message : lastError
    }`,
  );
}

// ── Auth (calqué sur sync-arpege-services) ──

type AuthContext = { authorized: boolean; isPrivileged: boolean; userId?: string };

async function checkAuth(
  req: Request,
  supabaseAdmin: AdminClient,
  supabaseUrl: string,
  anonKey: string,
): Promise<AuthContext> {
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

  const { data: userProfile } = await supabaseAdmin
    .from("users").select("is_superadmin").eq("id", user.id).single();
  if (userProfile?.is_superadmin) return { authorized: true, isPrivileged: true, userId: user.id };

  return { authorized: true, isPrivileged: false, userId: user.id };
}

// ── Handler ──

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

    const auth = await checkAuth(req, supabaseAdmin, supabaseUrl, anonKey);
    if (!auth.authorized) return json({ error: "Non autorisé" }, 401);

    // Action annexe : liste des organisations Socle (pour le mapping superadmin).
    const action = new URL(req.url).searchParams.get("action");
    if (action === "list-organizations") {
      if (!auth.isPrivileged) return json({ error: "Accès refusé" }, 403);
      const organizations = await fetchSocle("/v1/organizations");
      return json({ organizations });
    }

    const body = await req.json().catch(() => ({}));
    const filterOrgId: string | null = body.organization_id || null;
    const runInBackground: boolean = body.background !== false; // défaut true
    const dryRun: boolean = body.dry_run === true;

    // Un utilisateur non privilégié n'agit que sur sa propre org (admin requis).
    if (!auth.isPrivileged) {
      if (!filterOrgId) return json({ error: "organization_id requis" }, 400);
      const { data: targetOrgUser } = await supabaseAdmin
        .from("organization_users")
        .select("role")
        .eq("user_id", auth.userId)
        .eq("organization_id", filterOrgId)
        .maybeSingle();
      const isOrgAdmin =
        targetOrgUser?.role === "admin" || targetOrgUser?.role === "administrateur";
      if (!isOrgAdmin) return json({ error: "Accès refusé" }, 403);
    }

    // Organisations Clara mappées au Socle.
    let query = supabaseAdmin
      .from("organizations")
      .select("id, name, slug, logo_url, socle_org_id")
      .not("socle_org_id", "is", null);
    if (filterOrgId) query = query.eq("id", filterOrgId);
    const { data: orgs, error: orgsError } = await query;
    if (orgsError) throw orgsError;

    if (!orgs?.length) {
      return json({
        message: filterOrgId
          ? "Organisation non mappée au Socle (socle_org_id manquant)"
          : "Aucune organisation mappée au Socle",
        organizations: 0,
      }, filterOrgId ? 400 : 200);
    }

    const work = runSync(supabaseAdmin, orgs, dryRun);

    if (runInBackground) {
      const edgeRuntime = (globalThis as {
        EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void };
      }).EdgeRuntime;
      if (edgeRuntime?.waitUntil) {
        edgeRuntime.waitUntil(work);
      } else {
        work.catch((e) => console.error("[sync-socle] background error:", e));
      }
      return json({
        message: dryRun
          ? "Simulation (dry-run) lancée en arrière-plan"
          : "Synchronisation lancée en arrière-plan",
        organizations: orgs.length,
      }, 202);
    }

    const result = await work;
    return json({ message: dryRun ? "Simulation terminée" : "Synchronisation terminée", ...result });
  } catch (error) {
    console.error("[sync-socle] error:", error);
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});

// ── Synchronisation ──

interface ClaraOrg {
  id: string;
  name: string;
  slug: string | null;
  logo_url: string | null;
  socle_org_id: string;
}

interface OrgSyncResult {
  organization_id: string;
  organization_name: string;
  status: "success" | "error";
  counters?: {
    organizations: EntityCounters;
    categories: EntityCounters;
    document_types: EntityCounters;
    procedures: EntityCounters;
  };
  warnings?: string[];
  error?: string;
}

async function runSync(supabaseAdmin: AdminClient, orgs: ClaraOrg[], dryRun: boolean) {
  const syncedAt = new Date().toISOString();
  const results: OrgSyncResult[] = [];

  // Catalogue du périmètre de la clé — récupéré une seule fois. Avec une clé
  // plateforme, ce périmètre couvre PLUSIEURS organisations principales :
  // chaque tenant n'en mirrore que la part de SA racine (cf. syncOrg).
  const allOrganizations = (await fetchSocle("/v1/organizations")) as SocleOrgApi[];
  const categories = (await fetchSocle("/v1/categories")) as SocleCategory[];
  const documentTypes = (await fetchSocle("/v1/document-types")) as SocleDocumentType[];
  console.log(
    `[sync-socle] catalogue racine: ${allOrganizations.length} organisations, ${categories.length} catégories, ${documentTypes.length} types de documents${dryRun ? " (dry-run)" : ""}`,
  );

  for (const org of orgs) {
    // Journal de sync : une ligne par org et par run.
    const { data: runRow, error: runInsertError } = await supabaseAdmin
      .from("socle_sync_runs")
      .insert({ organization_id: org.id, status: "running", dry_run: dryRun })
      .select("id")
      .single();
    if (runInsertError) console.error("[sync-socle] socle_sync_runs insert:", runInsertError.message);
    const runId: string | null = runRow?.id ?? null;

    try {
      const { counters, warnings } = await syncOrg(supabaseAdmin, org, allOrganizations, categories, documentTypes, dryRun, syncedAt);
      if (runId) {
        await supabaseAdmin
          .from("socle_sync_runs")
          .update({ finished_at: new Date().toISOString(), status: "success", counters })
          .eq("id", runId);
      }
      const p = counters.procedures;
      console.log(
        `[sync-socle] org ${org.name}: démarches créées=${p.created} adoptées=${p.adopted} mises à jour=${p.updated} obsolètes=${p.obsoleted} inchangées=${p.unchanged}`,
      );
      results.push({
        organization_id: org.id,
        organization_name: org.name,
        status: "success",
        counters,
        warnings,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(`[sync-socle] org ${org.name}: ${message}`);
      if (runId) {
        await supabaseAdmin
          .from("socle_sync_runs")
          .update({ finished_at: new Date().toISOString(), status: "error", error: message })
          .eq("id", runId);
      }
      results.push({
        organization_id: org.id,
        organization_name: org.name,
        status: "error",
        error: message,
      });
      // Clé invalide : inutile de tenter les orgs suivantes.
      if (e instanceof SocleAuthError) break;
    }
  }

  return { dry_run: dryRun, results };
}

async function syncOrg(
  supabaseAdmin: AdminClient,
  org: ClaraOrg,
  allOrganizations: SocleOrgApi[],
  categories: SocleCategory[],
  documentTypes: SocleDocumentType[],
  dryRun: boolean,
  syncedAt: string,
): Promise<{ counters: OrgSyncResult["counters"]; warnings: string[] }> {
  // 0) Miroir de la hiérarchie d'organisations (sous-arbre du socle_org_id mappé).
  const subtree = filterSubtree(allOrganizations, org.socle_org_id);
  const organizationsCounters = await syncOrganizations(
    supabaseAdmin,
    org,
    subtree,
    dryRun,
    syncedAt,
  );

  // 0bis) Identité du tenant : l'org racine du Socle fixe nom, slug et logo
  // de l'organisation Clara (seules les couleurs restent gérées côté Clara).
  const root = subtree.find((o) => o.id === org.socle_org_id);
  const identity = root ? planTenantIdentityUpdate(org, root) : null;
  if (identity && !dryRun) {
    const { error: identityError } = await supabaseAdmin
      .from("organizations")
      .update(identity)
      .eq("id", org.id);
    if (identityError) throw new Error(`identité organisation: ${identityError.message}`);
    console.log(
      `[sync-socle] org ${org.name}: identité mise à jour depuis la racine Socle (${Object.keys(identity).join(", ")})`,
    );
  }

  // 1) Miroirs catégories + types de documents. Le catalogue vit à la RACINE
  // de l'org mappée : on ne mirrore que la part de cette racine — avec une clé
  // plateforme (multi-racines), le catalogue des autres principales ne doit
  // pas fuiter dans ce tenant.
  const rootId = rootOrgId(allOrganizations, org.socle_org_id);
  const categoriesCounters = await syncMirror(
    supabaseAdmin,
    "socle_categories",
    org.id,
    catalogueForRoot(categories, rootId).map((c) => ({ id: c.id, name: c.name, icon: c.icon ?? null })),
    dryRun,
    syncedAt,
    true,
  );
  const documentTypesCounters = await syncMirror(
    supabaseAdmin,
    "socle_document_types",
    org.id,
    catalogueForRoot(documentTypes, rootId).map((d) => ({ id: d.id, name: d.name })),
    dryRun,
    syncedAt,
    false,
  );

  // 2) Démarches activées pour cette org, puis config intégrale par démarche
  //    (appels séquentiels — volumes faibles, pas de pagination côté API).
  const enabled = (await fetchSocle(
    `/v1/procedures?enabled_for=${encodeURIComponent(org.socle_org_id)}`,
  )) as SocleProcedure[];
  const detailed: SocleProcedure[] = [];
  for (const p of enabled) {
    detailed.push((await fetchSocle(`/v1/procedures/${p.id}`)) as SocleProcedure);
  }

  // 3) Plan de sync (upsert par socle_id, adoption par nom, obsolescence).
  const { data: existing, error: existingError } = await supabaseAdmin
    .from("procedures")
    .select(PROCEDURE_SYNC_COLUMNS)
    .eq("organization_id", org.id);
  if (existingError) throw existingError;

  const plan = planProcedureSync(existing as ProcedureRow[], detailed, syncedAt);
  for (const w of plan.warnings) console.warn(`[sync-socle] org ${org.name}: ${w}`);

  // 4) Exécution (sauf dry-run).
  if (!dryRun) {
    for (const proc of plan.toInsert) {
      const { error } = await supabaseAdmin
        .from("procedures")
        .insert({ organization_id: org.id, is_displayed: true, ...mapSocleProcedure(proc, syncedAt) });
      if (error) throw new Error(`insertion « ${proc.name} »: ${error.message}`);
    }

    // Adoption d'un embryon ou mise à jour d'une démarche connue : mêmes champs,
    // is_displayed restauré uniquement en cas de réactivation post-obsolescence.
    for (const { existingId, proc, reactivate } of [...plan.toAdopt, ...plan.toUpdate]) {
      const fields: Record<string, unknown> = mapSocleProcedure(proc, syncedAt);
      if (reactivate) fields.is_displayed = true;
      const { error } = await supabaseAdmin.from("procedures").update(fields).eq("id", existingId);
      if (error) throw new Error(`mise à jour « ${proc.name} »: ${error.message}`);
    }

    // Soft-delete : jamais de suppression physique (action_tickets ON DELETE RESTRICT).
    if (plan.toObsolete.length > 0) {
      const { error } = await supabaseAdmin
        .from("procedures")
        .update({ obsoleted_at: syncedAt, is_displayed: false })
        .in("id", plan.toObsolete);
      if (error) throw new Error(`obsolescence: ${error.message}`);
    }
  }

  return {
    counters: {
      organizations: organizationsCounters,
      categories: categoriesCounters,
      document_types: documentTypesCounters,
      procedures: countersFromProcedurePlan(plan),
    },
    warnings: plan.warnings,
  };
}

// ── Miroir des organisations (hiérarchie) ──

async function syncOrganizations(
  supabaseAdmin: AdminClient,
  org: ClaraOrg,
  subtree: SocleOrgApi[],
  dryRun: boolean,
  syncedAt: string,
): Promise<EntityCounters> {
  if (subtree.length === 0) {
    console.warn(
      `[sync-socle] org ${org.name}: socle_org_id ${org.socle_org_id} introuvable dans le périmètre de la clé`,
    );
  }

  const { data: existing, error } = await supabaseAdmin
    .from("socle_organizations")
    .select(
      "id, socle_id, socle_parent_id, name, slug, type, status, phone, email, address, logo_url, obsoleted_at",
    )
    .eq("organization_id", org.id);
  if (error) throw error;

  const plan = planOrganizationSync(existing as OrgMirrorRow[], subtree);

  if (!dryRun) {
    for (const item of plan.toInsert) {
      const { error: insertError } = await supabaseAdmin
        .from("socle_organizations")
        .insert({ organization_id: org.id, ...mapSocleOrganization(item, syncedAt) });
      if (insertError) {
        throw new Error(`socle_organizations insertion « ${item.name} »: ${insertError.message}`);
      }
    }

    for (const { existingId, org: item } of plan.toUpdate) {
      const { error: updateError } = await supabaseAdmin
        .from("socle_organizations")
        .update(mapSocleOrganization(item, syncedAt))
        .eq("id", existingId);
      if (updateError) {
        throw new Error(`socle_organizations mise à jour « ${item.name} »: ${updateError.message}`);
      }
    }

    if (plan.toObsolete.length > 0) {
      const { error: obsoleteError } = await supabaseAdmin
        .from("socle_organizations")
        .update({ obsoleted_at: syncedAt })
        .in("id", plan.toObsolete);
      if (obsoleteError) throw new Error(`socle_organizations obsolescence: ${obsoleteError.message}`);
    }
  }

  return countersFromOrgPlan(plan);
}

async function syncMirror(
  supabaseAdmin: AdminClient,
  table: "socle_categories" | "socle_document_types",
  orgId: string,
  items: MirrorItem[],
  dryRun: boolean,
  syncedAt: string,
  hasIcon: boolean,
): Promise<EntityCounters> {
  const columns = hasIcon
    ? "id, socle_id, name, icon, obsoleted_at"
    : "id, socle_id, name, obsoleted_at";
  const { data: existing, error } = await supabaseAdmin
    .from(table)
    .select(columns)
    .eq("organization_id", orgId);
  if (error) throw error;

  const plan = planMirrorSync(existing as MirrorRow[], items);

  if (!dryRun) {
    for (const item of plan.toInsert) {
      const row: Record<string, unknown> = {
        organization_id: orgId,
        socle_id: item.id,
        name: item.name,
        synced_at: syncedAt,
      };
      if (hasIcon) row.icon = item.icon ?? null;
      const { error: insertError } = await supabaseAdmin.from(table).insert(row);
      if (insertError) throw new Error(`${table} insertion « ${item.name} »: ${insertError.message}`);
    }

    for (const { existingId, item } of plan.toUpdate) {
      const row: Record<string, unknown> = {
        name: item.name,
        synced_at: syncedAt,
        obsoleted_at: null,
      };
      if (hasIcon) row.icon = item.icon ?? null;
      const { error: updateError } = await supabaseAdmin.from(table).update(row).eq("id", existingId);
      if (updateError) throw new Error(`${table} mise à jour « ${item.name} »: ${updateError.message}`);
    }

    if (plan.toObsolete.length > 0) {
      const { error: obsoleteError } = await supabaseAdmin
        .from(table)
        .update({ obsoleted_at: syncedAt })
        .in("id", plan.toObsolete);
      if (obsoleteError) throw new Error(`${table} obsolescence: ${obsoleteError.message}`);
    }
  }

  return countersFromMirrorPlan(plan);
}
