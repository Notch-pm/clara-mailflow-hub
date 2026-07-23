/**
 * Proxy authentifié vers l'API contacts du Socle (référentiel des usagers).
 *
 * Le Socle est la source de vérité des contacts : Clara ne stocke aucune
 * donnée d'identité, seulement des références (`courier_participants.socle_contact_id`).
 * Le frontend n'appelle JAMAIS le Socle en direct — la clé API (scope
 * `contacts`) est un secret serveur ; ce proxy est le point de passage unique.
 *
 * Auth : JWT utilisateur, membre actif de l'organisation demandée (ou superadmin).
 *
 * Body : { action: "list"|"get"|"match"|"create"|"update"|"archive"|"restore"|"roles",
 *          organization_id: uuid, id?: uuid, payload?: object, filters?: object }
 *
 * `match` (rapprochement d'identités pour la détection de doublons) est en
 * lecture seule malgré son POST : aucune fiche créée ni modifiée.
 *
 * Réponse : relaie le statut et le corps du Socle (erreurs au format
 * `{ error: { code, message } }`). Particularités :
 *  - 503 `not_configured` : tenant sans socle_org_id ou sans clé contacts ;
 *  - 502 `socle_auth_failed` : clé Socle refusée (401/403 côté Socle) — jamais
 *    relayé en 401 pour ne pas faire déconnecter l'utilisateur ;
 *  - 502 `socle_unreachable` : Socle injoignable après retries.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildSocleRequest, isUuid } from "../_shared/socleContactsLogic.ts";
import {
  contactsApiKeyForOrg,
  fetchContactsApi,
  SocleContactsApiError,
  SocleContactsAuthError,
} from "../_shared/socleContactsClient.ts";
import { assertEditor } from "../_shared/authz.ts";

/**
 * Actions de mutation de contact (création/modification/archivage) : seules
 * celles-ci sont bloquées pour un consultant. `match` est un POST mais reste
 * une lecture seule (rapprochement d'identités, aucune fiche créée/modifiée) ;
 * `list`, `get`, `roles` sont également des lectures. Cf. `buildSocleRequest`.
 */
const CONTACT_MUTATION_ACTIONS = new Set(["create", "update", "archive", "restore"]);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-org-id, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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
  const token = authHeader.replace("Bearer ", "");
  const { data, error } = await anonClient.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return errorResponse("method_not_allowed", "Méthode non autorisée.", 405);
  }

  try {
    const user = await verifyAuth(req);
    if (!user) return errorResponse("unauthorized", "Non autorisé.", 401);

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return errorResponse("bad_request", "Corps JSON invalide.", 400);
    }
    const { action, organization_id, id, payload, filters } = (body ?? {}) as Record<string, unknown>;

    if (!isUuid(organization_id)) {
      return errorResponse("bad_request", "organization_id invalide (uuid attendu).", 400);
    }

    const admin = getAdminClient();
    if (!(await isMemberOrSuperadmin(admin, user.id, organization_id))) {
      return errorResponse("forbidden", "Vous n'êtes pas membre de cette organisation.", 403);
    }

    // Le consultant est en lecture seule : la recherche/consultation reste
    // ouverte (list/get/match/roles), seules les mutations de contact sont
    // bloquées.
    if (
      typeof action === "string" &&
      CONTACT_MUTATION_ACTIONS.has(action) &&
      !(await assertEditor(admin, user.id, organization_id))
    ) {
      return errorResponse(
        "forbidden",
        "Accès refusé : rôle consultant en lecture seule.",
        403,
      );
    }

    const { data: org } = await admin
      .from("organizations")
      .select("socle_org_id")
      .eq("id", organization_id)
      .single();
    const apiKey = contactsApiKeyForOrg(org?.socle_org_id as string | null);
    if (!apiKey) {
      return errorResponse(
        "not_configured",
        "Référentiel de contacts non configuré pour cette organisation (socle_org_id ou clé API manquants).",
        503,
      );
    }

    const built = buildSocleRequest(action, { id, payload, filters });
    if (!built.ok) return errorResponse("bad_request", built.message, 400);

    const { status, body: socleBody } = await fetchContactsApi(apiKey, built.request, {
      socleOrgId: org?.socle_org_id as string | null,
    });
    return jsonResponse(socleBody, status);
  } catch (e) {
    if (e instanceof SocleContactsAuthError) {
      return errorResponse(
        "socle_auth_failed",
        "Le référentiel a refusé la clé API contacts — vérifiez le secret SOCLE_CONTACTS_API_KEYS (scope `contacts`).",
        502,
      );
    }
    if (e instanceof SocleContactsApiError) {
      // Erreur applicative Socle (400/404/409…) : relayée telle quelle.
      return errorResponse(e.code, e.message, e.status);
    }
    console.error("socle-contacts error:", e);
    return errorResponse(
      "socle_unreachable",
      e instanceof Error ? e.message : "Référentiel de contacts injoignable.",
      502,
    );
  }
});
