// Synchronisation nocturne du référentiel Socle → Clara.
// Le Socle est la source de vérité des démarches : catégories, types de documents
// et démarches activées par organisation sont miroirés dans Clara (upsert idempotent
// par socle_id, soft-delete des éléments disparus). Voir logic.ts pour la logique pure.
//
// Il l'est aussi du SERVEUR D'ENVOI (SMTP) depuis le 2026-08-23 : le relais est
// défini une fois dans le Socle sur l'organisation racine, Clara n'en tient
// qu'un miroir (`smtp_settings`, écrit par les RPC de service
// sync_smtp_settings_from_socle / clear_smtp_settings_from_socle). Voir smtp.ts
// pour la logique pure.
//
// Et de la CHARTE GRAPHIQUE depuis le 2026-09-13 : logo et couleurs principale
// et secondaire ne se saisissent plus dans Clara, ils sont recopiés de
// `GET /v1/organizations/{tenant}/branding` (héritage déjà résolu côté Socle).
// Voir branding.ts pour la logique pure. L'identité (`planTenantIdentityUpdate`)
// ne fixe plus que le nom et le slug.
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
  countersFromActivationPlan,
  countersFromMirrorPlan,
  countersFromOrgPlan,
  countersFromProcedurePlan,
  filterSubtree,
  hasFullConfig,
  rootOrgId,
  mapSocleOrganization,
  mapSocleProcedure,
  planActivationSync,
  planMirrorSync,
  planOrganizationSync,
  planProcedureSync,
  planTenantIdentityUpdate,
  type ActivationItem,
  type ActivationRow,
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
import {
  smtpMirrorArgs,
  smtpRootUnknownWarning,
  smtpWarning,
  type SmtpTenantRef,
  type SocleSmtpDto,
} from "./smtp.ts";
import {
  brandingWarning,
  planBrandingUpdate,
  type BrandingMirror,
  type SocleBrandingDto,
} from "./branding.ts";

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

/** Plafond d'attente d'un « Retry after » : au-delà, le run n'a plus de sens. */
const MAX_RATE_LIMIT_WAIT_MS = 45_000;

/**
 * Délai demandé par un plafond de cadence, lu dans le message de l'erreur
 * (« Rate limit exceeded for trace …. Retry after 39185ms. » — l'erreur est
 * levée par le runtime, il n'y a pas de réponse HTTP à en-têtes à lire).
 * Rend `null` pour toute autre erreur : le backoff maison reprend la main.
 */
function retryAfterMs(e: unknown): number | null {
  const message = e instanceof Error ? e.message : String(e);
  if (!/rate limit/i.test(message)) return null;
  const match = message.match(/retry after (\d+)\s*ms/i);
  const hinted = match ? Number(match[1]) : NaN;
  if (!Number.isFinite(hinted) || hinted <= 0) return MAX_RATE_LIMIT_WAIT_MS;
  return Math.min(hinted + 500, MAX_RATE_LIMIT_WAIT_MS);
}

async function fetchSocle(path: string): Promise<unknown> {
  // trim défensif : un espace/retour à la ligne collé au secret casserait le hash SHA-256 côté Socle
  const apiKey = Deno.env.get("SOCLE_API_KEY")?.trim();
  if (!apiKey) throw new Error("Secret SOCLE_API_KEY manquant — configurez-le dans les secrets de la fonction");
  const url = `${socleBaseUrl()}${path}`;

  let lastError: unknown = null;
  let rateLimitWaitMs: number | null = null;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      // Un plafond de cadence dit COMBIEN attendre : le respecter est le seul
      // moyen de repasser. Le backoff maison (1s/3s/9s) est bien trop court
      // pour ça — les trois tentatives se consommeraient pour rien.
      const delay = rateLimitWaitMs ?? RETRY_DELAYS_MS[attempt - 1];
      rateLimitWaitMs = null;
      await new Promise((r) => setTimeout(r, delay));
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
      rateLimitWaitMs = retryAfterMs(e);
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

/**
 * Serveur d'envoi d'une organisation racine. À la différence des autres
 * lectures, un statut d'erreur n'est PAS une exception : une clé sans le scope
 * `smtp` (403) ou un Socle antérieur à cette route (404) doivent laisser la
 * synchronisation du référentiel réussir, avec un avertissement. Seul le 401
 * (clé morte) reste fatal, comme partout ailleurs.
 *
 * Pas de retry : l'échec n'écrit rien, laisse le miroir en l'état et se voit
 * dans les avertissements du journal de synchronisation.
 */
async function fetchSocleSmtp(
  socleOrgId: string,
): Promise<{ status: number; dto: SocleSmtpDto | null }> {
  const apiKey = Deno.env.get("SOCLE_API_KEY")?.trim();
  if (!apiKey) throw new Error("Secret SOCLE_API_KEY manquant — configurez-le dans les secrets de la fonction");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SOCLE_TIMEOUT_MS);
  try {
    const response = await fetch(
      `${socleBaseUrl()}/v1/organizations/${encodeURIComponent(socleOrgId)}/smtp`,
      {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
        signal: controller.signal,
      },
    );
    if (response.status === 401) {
      await response.body?.cancel();
      throw new SocleAuthError(
        "Clé API Socle invalide ou révoquée (401) — synchronisation interrompue",
      );
    }
    if (!response.ok) {
      await response.body?.cancel();
      return { status: response.status, dto: null };
    }
    return { status: 200, dto: (await response.json()) as SocleSmtpDto };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Charte graphique applicable à une organisation — mêmes règles que
 * `fetchSocleSmtp` : pas de retry, un statut d'erreur n'est pas une exception
 * (le miroir reste en l'état, un avertissement le dit), seul le 401 est fatal.
 *
 * L'organisation interrogée est celle du TENANT, pas sa racine : la route
 * résout l'héritage, une sous-organisation qui porte sa propre charte garde
 * la sienne.
 */
async function fetchSocleBranding(
  socleOrgId: string,
): Promise<{ status: number; dto: SocleBrandingDto | null }> {
  const apiKey = Deno.env.get("SOCLE_API_KEY")?.trim();
  if (!apiKey) throw new Error("Secret SOCLE_API_KEY manquant — configurez-le dans les secrets de la fonction");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SOCLE_TIMEOUT_MS);
  try {
    const response = await fetch(
      `${socleBaseUrl()}/v1/organizations/${encodeURIComponent(socleOrgId)}/branding`,
      {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
        signal: controller.signal,
      },
    );
    if (response.status === 401) {
      await response.body?.cancel();
      throw new SocleAuthError(
        "Clé API Socle invalide ou révoquée (401) — synchronisation interrompue",
      );
    }
    if (!response.ok) {
      await response.body?.cancel();
      return { status: response.status, dto: null };
    }
    return { status: 200, dto: (await response.json()) as SocleBrandingDto };
  } finally {
    clearTimeout(timer);
  }
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
      .select("id, name, slug, logo_url, primary_color, secondary_color, socle_org_id")
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

interface ClaraOrg extends Partial<BrandingMirror> {
  id: string;
  name: string;
  slug: string | null;
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
    /** Miroir « quelle organisation propose quelle démarche ». */
    activations: EntityCounters;
    /** Miroirs du serveur d'envoi écrits (0 ou 1 : un relais par tenant). */
    smtp_synchronises: number;
    /** Miroirs effacés faute de relais déclaré côté Socle (0 ou 1). */
    smtp_retires: number;
    /** Charte graphique (logo + couleurs) relue et appliquée (0 ou 1) — 0 = miroir laissé en l'état. */
    charte_synchronisee: number;
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
          .update({
            finished_at: new Date().toISOString(),
            status: "success",
            // Les avertissements voyagent AVEC les compteurs : un miroir laissé
            // en l'état (scope manquant, organisation hors périmètre) doit se
            // lire dans le journal, pas seulement dans la réponse HTTP d'un
            // déclenchement manuel.
            counters: warnings.length > 0 ? { ...counters, warnings } : counters,
          })
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

  // 0bis) Identité du tenant : l'org Socle mappée fixe nom et slug de
  // l'organisation Clara. Le logo, lui, appartient à la charte (0ter).
  const root = subtree.find((o) => o.id === org.socle_org_id);
  const identity = root ? planTenantIdentityUpdate(org, root) : null;

  // 0ter) Charte graphique : logo et couleurs viennent du référentiel depuis le
  // 2026-09-13 — plus aucune saisie dans Clara. Écrite dans la MÊME mise à jour
  // que l'identité : c'est la même ligne, et les deux décrivent qui est la
  // collectivité.
  const branding = await syncBranding(org);

  const tenantUpdate = { ...(identity ?? {}), ...(branding.fields ?? {}) };
  if (Object.keys(tenantUpdate).length > 0 && !dryRun) {
    const { error: identityError } = await supabaseAdmin
      .from("organizations")
      .update(tenantUpdate)
      .eq("id", org.id);
    if (identityError) throw new Error(`identité organisation: ${identityError.message}`);
    console.log(
      `[sync-socle] org ${org.name}: identité/charte mises à jour depuis le Socle (${Object.keys(tenantUpdate).join(", ")})`,
    );
  }

  // 1) Miroirs catégories + types de documents. Le catalogue vit à la RACINE
  // de l'org mappée : on ne mirrore que la part de cette racine — avec une clé
  // plateforme (multi-racines), le catalogue des autres principales ne doit
  // pas fuiter dans ce tenant.
  const rootId = rootOrgId(allOrganizations, org.socle_org_id);

  // 1bis) Serveur d'envoi : le Socle en est propriétaire, Clara n'en tient
  // qu'un miroir. La route n'existe que sur une RACINE — un tenant mappé sur
  // une sous-organisation (« Marie d'Arles ») hérite donc du relais de sa
  // racine, comme il hérite déjà de son référentiel de contacts.
  //
  // Un échec ici ne fait échouer ni les autres tenants, ni la synchronisation
  // du référentiel : le miroir reste en l'état et un avertissement dit quoi
  // faire. Placé avant les démarches pour qu'un incident de catalogue ne prive
  // pas le tenant de son relais.
  const smtp = await syncSmtp(supabaseAdmin, org, rootId, dryRun);

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

  // 2) Démarches proposées par CHAQUE organisation du sous-arbre (appels
  //    séquentiels — volumes faibles, pas de pagination côté API).
  //
  //    ⚠️ Un seul appel sur la racine ne suffit pas : le filtre `enabled_for`
  //    N'EST PAS RÉCURSIF. Interroger ACCM ne dit rien de ce que proposent ses
  //    sous-organisations — et le sous-arbre en propose deux fois plus que la
  //    racine. Le catalogue Clara est donc l'UNION du sous-arbre, et le miroir
  //    `procedure_organizations` dit qui propose quoi (étape 5).
  const activations: Array<{ socleOrgId: string; name: string; procedureSocleIds: string[] }> = [];
  const muteOrgs: string[] = [];
  const catalogue = new Map<string, SocleProcedure>();
  for (const socleOrg of subtree) {
    try {
      const enabled = (await fetchSocle(
        `/v1/procedures?enabled_for=${encodeURIComponent(socleOrg.id)}`,
      )) as SocleProcedure[];
      const ids = (enabled ?? []).map((p) => p.id).filter((id): id is string => typeof id === "string");
      activations.push({ socleOrgId: socleOrg.id, name: socleOrg.name, procedureSocleIds: ids });
      for (const p of enabled ?? []) if (p?.id) catalogue.set(p.id, p);
    } catch (e) {
      // Clé invalide : rien ne servira, on remonte sans insister.
      if (e instanceof SocleAuthError) throw e;
      // Organisation muette : on ne conclut RIEN pour elle (ni catalogue, ni
      // obsolescence) — la périmer fermerait son guichet jusqu'au run suivant.
      const message = e instanceof Error ? e.message : String(e);
      console.warn(`[sync-socle] org ${org.name}: démarches de « ${socleOrg.name} » illisibles: ${message}`);
      muteOrgs.push(socleOrg.name);
    }
  }

  // ⚠️ PAS d'appel de détail par démarche : `GET /v1/procedures?enabled_for=`
  // et `GET /v1/procedures/{id}` passent par le MÊME sérialiseur côté Socle —
  // la liste porte déjà `form_schema`, `requester_config`, `knowledge_base` et
  // `translations`. Les rappeler une à une multipliait les appels par trois et
  // faisait sauter le plafond de cadence de la plateforme (constaté le
  // 2026-09-10, à l'élargissement au sous-arbre). On ne redemande le détail que
  // si la liste rend un objet manifestement amputé — garde contre un futur
  // allègement du DTO de liste, jamais le cas nominal.
  const detailed: SocleProcedure[] = [];
  for (const [id, listed] of catalogue) {
    detailed.push(
      hasFullConfig(listed) ? listed : ((await fetchSocle(`/v1/procedures/${id}`)) as SocleProcedure),
    );
  }

  // 3) Plan de sync (upsert par socle_id, adoption par nom, obsolescence).
  const { data: existing, error: existingError } = await supabaseAdmin
    .from("procedures")
    .select(PROCEDURE_SYNC_COLUMNS)
    .eq("organization_id", org.id);
  if (existingError) throw existingError;

  const plan = planProcedureSync(existing as ProcedureRow[], detailed, syncedAt);
  // Une organisation muette ampute l'union : ses démarches exclusives
  // paraîtraient disparues du Socle. On suspend TOUTE obsolescence de
  // catalogue pour ce run plutôt que d'en périmer à tort.
  if (muteOrgs.length > 0 && plan.toObsolete.length > 0) {
    plan.warnings.push(
      `Obsolescence des démarches suspendue : ${muteOrgs.length} organisation(s) illisible(s) (${muteOrgs.join(", ")}).`,
    );
    plan.toObsolete = [];
  }
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

  // 5) Miroir « qui propose quoi ». Écrit APRÈS le catalogue : les lignes
  //    référencent `procedures.id`, qui n'existe qu'une fois les démarches
  //    insérées. En dry-run, rien n'a été écrit — on ne peut donc rien mirrorer.
  const activationsCounters = dryRun
    ? { created: 0, updated: 0, adopted: 0, obsoleted: 0, unchanged: 0 }
    : await syncActivations(supabaseAdmin, org, activations, muteOrgs, syncedAt);

  const warnings = [...smtp.warnings, ...branding.warnings, ...plan.warnings];
  if (muteOrgs.length > 0) {
    warnings.push(
      `Démarches illisibles pour ${muteOrgs.length} organisation(s) (${muteOrgs.join(", ")}) — leur miroir est inchangé.`,
    );
  }

  return {
    counters: {
      organizations: organizationsCounters,
      categories: categoriesCounters,
      document_types: documentTypesCounters,
      procedures: countersFromProcedurePlan(plan),
      activations: activationsCounters,
      smtp_synchronises: smtp.synchronises,
      smtp_retires: smtp.retires,
      charte_synchronisee: branding.synchronisee,
    },
    warnings,
  };
}

// ── Charte graphique (miroir du Socle) ──

/**
 * Relit la charte applicable au tenant et rend les couleurs à réécrire, ou
 * `null` si le miroir est déjà aligné. N'ÉCRIT RIEN : l'appelant fusionne ces
 * champs avec l'identité pour ne faire qu'une mise à jour de `organizations`.
 *
 * Un échec ne fait échouer ni les autres tenants ni la synchronisation : la
 * charte reste celle du dernier passage réussi, et un avertissement dit
 * pourquoi. Contrairement au relais SMTP, une charte manquante n'empêche rien —
 * les gabarits de mails ont leurs couleurs de repli, et un mail sans logo part
 * quand même.
 */
async function syncBranding(
  org: ClaraOrg,
): Promise<{ fields: Partial<BrandingMirror> | null; synchronisee: number; warnings: string[] }> {
  try {
    const { status, dto } = await fetchSocleBranding(org.socle_org_id);
    if (status !== 200) {
      return { fields: null, synchronisee: 0, warnings: [brandingWarning(org.name, status)] };
    }
    return { fields: planBrandingUpdate(org, dto), synchronisee: 1, warnings: [] };
  } catch (e) {
    // Clé morte : la synchronisation entière s'arrête, comme partout ailleurs.
    if (e instanceof SocleAuthError) throw e;
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[sync-socle] org ${org.name}: charte graphique: ${message}`);
    return {
      fields: null,
      synchronisee: 0,
      warnings: [`charte graphique (${org.name}) : ${message} — miroir inchangé.`],
    };
  }
}

// ── Miroir d'activation des démarches par organisation ──
//
// Opt-in strict : ce que le Socle n'active pas n'est pas proposé. Les lignes
// portent des ids CLARA (démarche mirrorée × organisation mirrorée), la
// traversée des deux miroirs se fait ici, une fois pour toutes.
async function syncActivations(
  supabaseAdmin: AdminClient,
  org: ClaraOrg,
  activations: Array<{ socleOrgId: string; name: string; procedureSocleIds: string[] }>,
  muteOrgs: string[],
  syncedAt: string,
): Promise<EntityCounters> {
  const [{ data: orgMirror, error: orgErr }, { data: procMirror, error: procErr }] = await Promise.all([
    supabaseAdmin
      .from("socle_organizations")
      .select("id, socle_id")
      .eq("organization_id", org.id),
    supabaseAdmin
      .from("procedures")
      .select("id, socle_id")
      .eq("organization_id", org.id)
      .not("socle_id", "is", null),
  ]);
  if (orgErr) throw new Error(`miroir organisations: ${orgErr.message}`);
  if (procErr) throw new Error(`miroir démarches: ${procErr.message}`);

  const orgIdBySocleId = new Map(
    (orgMirror ?? []).map((r: { id: string; socle_id: string }) => [r.socle_id, r.id]),
  );
  const procIdBySocleId = new Map(
    (procMirror ?? []).map((r: { id: string; socle_id: string }) => [r.socle_id, r.id]),
  );

  const incoming: ActivationItem[] = [];
  const observedOrgIds: string[] = [];
  for (const activation of activations) {
    const mirrorOrgId = orgIdBySocleId.get(activation.socleOrgId);
    if (!mirrorOrgId) continue; // organisation hors miroir (premier run partiel)
    observedOrgIds.push(mirrorOrgId);
    for (const socleProcId of activation.procedureSocleIds) {
      const procedureId = procIdBySocleId.get(socleProcId);
      if (!procedureId) continue; // démarche non mirrorée (détail illisible)
      incoming.push({ procedure_id: procedureId, socle_organization_id: mirrorOrgId });
    }
  }

  const { data: existing, error: existingError } = await supabaseAdmin
    .from("procedure_organizations")
    .select("procedure_id, socle_organization_id, obsoleted_at")
    .eq("organization_id", org.id);
  if (existingError) throw existingError;

  const plan = planActivationSync(existing as ActivationRow[], incoming, observedOrgIds);

  const upserts = [...plan.toInsert, ...plan.toReactivate];
  if (upserts.length > 0) {
    const { error } = await supabaseAdmin
      .from("procedure_organizations")
      .upsert(
        upserts.map((a) => ({
          organization_id: org.id,
          procedure_id: a.procedure_id,
          socle_organization_id: a.socle_organization_id,
          synced_at: syncedAt,
          obsoleted_at: null,
        })),
        { onConflict: "organization_id,procedure_id,socle_organization_id" },
      );
    if (error) throw new Error(`activations: ${error.message}`);
  }

  // Soft-delete ligne à ligne : la clé est composite, `.in()` ne sait pas
  // l'exprimer. Les volumes sont ceux d'un référentiel (quelques dizaines).
  for (const a of plan.toObsolete) {
    const { error } = await supabaseAdmin
      .from("procedure_organizations")
      .update({ obsoleted_at: syncedAt })
      .eq("organization_id", org.id)
      .eq("procedure_id", a.procedure_id)
      .eq("socle_organization_id", a.socle_organization_id);
    if (error) throw new Error(`activations obsolescence: ${error.message}`);
  }

  console.log(
    `[sync-socle] org ${org.name}: activations créées=${plan.toInsert.length} réactivées=${plan.toReactivate.length} retirées=${plan.toObsolete.length} inchangées=${plan.unchanged}${muteOrgs.length ? ` (${muteOrgs.length} organisation(s) muette(s))` : ""}`,
  );
  return countersFromActivationPlan(plan);
}

// ── Serveur d'envoi (miroir du Socle) ──

/**
 * Recopie dans `smtp_settings` le relais déclaré par le Socle pour la racine du
 * tenant, ou EFFACE le miroir si le Socle n'en déclare plus d'exploitable.
 *
 * Miroir strict : ce que le Socle déclare fait foi, y compris l'absence — un
 * miroir qui survit à sa source ment. Clara n'ayant aucun relais de repli,
 * effacer signifie « ce tenant n'expédie plus » : c'est le comportement voulu,
 * une configuration périmée ferait échouer les envois sans le dire.
 *
 * Le mot de passe ne fait que passer d'ici vers la RPC de service : il n'est
 * jamais journalisé, ni compté, ni repris dans un message d'erreur.
 */
async function syncSmtp(
  supabaseAdmin: AdminClient,
  org: ClaraOrg,
  rootId: string | null,
  dryRun: boolean,
): Promise<{ synchronises: number; retires: number; warnings: string[] }> {
  const warnings: string[] = [];
  if (!rootId) {
    warnings.push(smtpRootUnknownWarning(org.name, org.socle_org_id));
    return { synchronises: 0, retires: 0, warnings };
  }

  const tenant: SmtpTenantRef = {
    organizationId: org.id,
    organizationName: org.name,
    rootSocleOrgId: rootId,
  };

  try {
    const { status, dto } = await fetchSocleSmtp(rootId);
    if (status !== 200) {
      warnings.push(smtpWarning(tenant, status));
      return { synchronises: 0, retires: 0, warnings };
    }

    const args = smtpMirrorArgs(tenant, dto);

    if (args) {
      if (!dryRun) {
        const { error } = await supabaseAdmin.rpc("sync_smtp_settings_from_socle", args);
        if (error) throw new Error(error.message);
      }
      console.log(
        `[sync-socle] org ${org.name}: serveur d'envoi synchronisé depuis la racine Socle${dryRun ? " (dry-run)" : ""}`,
      );
      return { synchronises: 1, retires: 0, warnings };
    }

    // Aucun relais exploitable côté Socle : le miroir s'efface.
    if (dryRun) {
      const { count } = await supabaseAdmin
        .from("smtp_settings")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", org.id);
      return { synchronises: 0, retires: count ?? 0, warnings };
    }
    const { data: retire, error } = await supabaseAdmin
      .rpc("clear_smtp_settings_from_socle", { p_org_id: org.id });
    if (error) throw new Error(error.message);
    if (retire === true) {
      console.log(`[sync-socle] org ${org.name}: serveur d'envoi retiré (le Socle n'en déclare plus)`);
      return { synchronises: 0, retires: 1, warnings };
    }
    return { synchronises: 0, retires: 0, warnings };
  } catch (e) {
    // Clé morte : la synchronisation entière s'arrête, comme partout ailleurs.
    if (e instanceof SocleAuthError) throw e;
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[sync-socle] org ${org.name}: serveur d'envoi: ${message}`);
    warnings.push(`serveur d'envoi (${org.name}) : ${message} — miroir inchangé.`);
    return { synchronises: 0, retires: 0, warnings };
  }
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
