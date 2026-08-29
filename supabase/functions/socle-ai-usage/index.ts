/**
 * Consommation IA de la collectivité — Paramètres › Consommation IA.
 *
 * Depuis la centralisation du 2026-08-29, le plafond, le compteur et la
 * période vivent dans le SOCLE (`ai-api`). L'écran de Clara ne lit donc plus
 * ses propres tables — elles n'existent plus — mais `GET /v1/usage` du
 * guichet, via ce proxy. Le frontend n'appelle jamais le Socle en direct : la
 * clé API (scope `ai`) est un secret serveur.
 *
 * ⚠️ LA GARDE D'ACCÈS EST ICI, ET ELLE N'EST PAS UNE PRÉCAUTION : C'EST LA
 * SEULE. La lecture passait auparavant par la policy RLS `auth_select`
 * (`is_member_of`) sur `ai_usage_quotas` / `ai_usage_counters`. Ces tables
 * ayant disparu, la lecture se fait ici en `service_role`, pour qui le RLS ne
 * s'applique pas. Sans le contrôle d'appartenance ci-dessous, n'importe quel
 * utilisateur authentifié lirait le budget de n'importe quelle collectivité.
 *
 * La règle reprise est EXACTEMENT l'ancienne — membre actif de l'organisation,
 * ou superadmin — pour que la bascule ne change pas qui voit quoi.
 *
 * ⚠️ CET ÉCRAN EST EN LECTURE SEULE, DÉFINITIVEMENT. Le plafond se règle dans
 * le Socle, qui le tient pour toute la gamme : le fixer depuis Clara ne
 * porterait que sur la part de Clara, c'est-à-dire sur rien — le compteur est
 * global. Aucune route d'écriture ici, et il ne faut pas en ajouter.
 *
 * Body : { organization_id: uuid, period?: "AAAA-MM" }
 * Réponse : { usage: { period, renews_at, limit, used_tokens, reserved_tokens,
 *                      by_consumer: [{ consumer, feature, calls, tokens }] } }
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { aiApiBaseUrl, socleAiKey, socleOrgIdFor } from "../_shared/socleAi.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-org-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** Au-dessus des 60 s du Socle, comme tout appel au guichet. */
const TIMEOUT_MS = 20_000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(code: string, message: string, status: number) {
  return jsonResponse({ error: { code, message } }, status);
}

function getAdminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function verifyAuth(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return null;
  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const anonClient = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data, error } = await anonClient.auth.getUser(authHeader.replace("Bearer ", ""));
  if (error || !data.user) return null;
  return data.user;
}

/** Jumeau SERVICE de l'ancienne policy `auth_select` (`is_member_of`). */
async function isMemberOrSuperadmin(
  admin: ReturnType<typeof getAdminClient>,
  userId: string,
  orgId: string,
): Promise<boolean> {
  const { data: userRow } = await admin
    .from("users")
    .select("is_superadmin")
    .eq("id", userId)
    .single();
  if (userRow?.is_superadmin) return true;
  const { data } = await admin
    .from("organization_users")
    .select("id")
    .eq("user_id", userId)
    .eq("organization_id", orgId)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  return Boolean(data);
}

interface ConsumerRow {
  consumer: string;
  feature: string | null;
  calls: number;
  tokens: number;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/**
 * Whitelist stricte de ce qui franchit la frontière vers le navigateur —
 * tolérante aux champs inconnus, que la politique de compatibilité v1 du Socle
 * autorise à ajouter sans prévenir.
 */
function sanitizeUsage(raw: unknown): Record<string, unknown> {
  const empty = {
    period: "",
    renews_at: null,
    limit: null,
    used_tokens: 0,
    reserved_tokens: 0,
    by_consumer: [] as ConsumerRow[],
  };
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return empty;
  const body = raw as Record<string, unknown>;

  const rows: ConsumerRow[] = [];
  if (Array.isArray(body.by_consumer)) {
    for (const entry of body.by_consumer) {
      if (typeof entry !== "object" || entry === null) continue;
      const row = entry as Record<string, unknown>;
      const consumer = typeof row.consumer === "string" ? row.consumer.trim() : "";
      // Sans nom d'application, la ligne n'apprend rien à un administrateur.
      if (consumer === "") continue;
      rows.push({
        consumer,
        feature: typeof row.feature === "string" && row.feature.trim() !== ""
          ? row.feature.trim()
          : null,
        calls: count(row.calls),
        tokens: count(row.tokens),
      });
    }
  }

  return {
    period: typeof body.period === "string" ? body.period : "",
    renews_at: typeof body.renews_at === "string" && body.renews_at !== "" ? body.renews_at : null,
    // Un plafond nul ou négatif VAUT aucun plafond.
    limit: typeof body.limit === "number" && Number.isFinite(body.limit) && body.limit > 0
      ? Math.floor(body.limit)
      : null,
    used_tokens: count(body.used_tokens),
    reserved_tokens: count(body.reserved_tokens),
    by_consumer: rows,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return errorResponse("method_not_allowed", "Méthode non autorisée.", 405);
  }

  try {
    const user = await verifyAuth(req);
    if (!user) return errorResponse("unauthorized", "Non autorisé.", 401);

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const organizationId = body?.organization_id;
    if (typeof organizationId !== "string" || !UUID_RE.test(organizationId)) {
      return errorResponse("bad_request", "organization_id invalide (uuid attendu).", 400);
    }

    // ⚠️ La période est REFUSÉE si malformée, jamais corrigée en silence :
    // afficher un mois pour un autre est pire qu'une erreur — un administrateur
    // y lirait une consommation qu'il croirait celle du mois en cours.
    const period = body?.period;
    if (period !== undefined && period !== null &&
        (typeof period !== "string" || !/^\d{4}-\d{2}$/.test(period))) {
      return errorResponse("bad_request", "period : AAAA-MM attendu.", 400);
    }

    const admin = getAdminClient();
    if (!(await isMemberOrSuperadmin(admin, user.id, organizationId))) {
      return errorResponse("forbidden", "Vous n'êtes pas membre de cette organisation.", 403);
    }

    const base = aiApiBaseUrl();
    const key = socleAiKey();
    if (base === "" || !key) {
      return errorResponse(
        "not_configured",
        "Le guichet IA du Socle n'est pas configuré sur cette instance.",
        503,
      );
    }

    const socleOrgId = await socleOrgIdFor(admin, organizationId);
    if (!socleOrgId) {
      return errorResponse(
        "not_configured",
        "Organisation non rattachée au Socle (socle_org_id manquant) : aucune consommation à afficher.",
        503,
      );
    }

    const query = typeof period === "string" ? `?period=${period}` : "";
    const res = await fetch(`${base}/v1/usage${query}`, {
      headers: { Authorization: `Bearer ${key}`, "X-Organization-Id": socleOrgId },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }).catch(() => null);

    if (!res) {
      return errorResponse("socle_unreachable", "Le référentiel ne répond pas.", 502);
    }
    if (!res.ok) {
      // ⚠️ Un 401/403 du Socle n'est JAMAIS relayé tel quel : il dit que la clé
      // de Clara est mauvaise ou sans le scope `ai`. Relayé en 401, il ferait
      // déconnecter un utilisateur qui n'y est pour rien.
      if (res.status === 401 || res.status === 403) {
        return errorResponse(
          "socle_auth_failed",
          "Le référentiel a refusé la clé API de Clara — vérifier le secret SOCLE_API_KEY (scope « ai »).",
          502,
        );
      }
      return errorResponse("socle_error", "Consommation IA indisponible.", 502);
    }

    return jsonResponse({ usage: sanitizeUsage(await res.json().catch(() => null)) });
  } catch (err) {
    console.error("socle-ai-usage:", err instanceof Error ? err.message : "inconnue");
    return errorResponse("internal_error", "Erreur interne du serveur.", 500);
  }
});
