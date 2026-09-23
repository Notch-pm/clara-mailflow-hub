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
 * Body : { action: "list"|"get"|"match"|"create"|"update"|"archive"|"restore"|"roles"
 *                  |"consents_record"|"consents_from_courier",
 *          organization_id: uuid, id?: uuid, payload?: object, filters?: object }
 *
 * `match` (rapprochement d'identités pour la détection de doublons) est en
 * lecture seule malgré son POST : aucune fiche créée ni modifiée.
 *
 * Consentements RGPD (`POST /v1/contacts/{id}/consents` côté Socle) — deux
 * gestes, et pour les deux le corps est COMPOSÉ ICI, jamais relayé depuis le
 * navigateur (la phrase consignée fait la preuve, elle ne vient pas d'un client) :
 *  - `consents_record` : consignation manuelle par un agent éditeur,
 *    payload `{ answers: [{kind, granted}], collected_at?, reference? }` ;
 *    le libellé est composé depuis le catalogue et `organizations.name`.
 *  - `consents_from_courier` : report de la trace d'un courrier déposé au
 *    portail (`couriers.consents`), payload `{ courier_id }` ; les libellés
 *    sont ceux du dépôt, repris tels quels. Le courrier doit appartenir à
 *    l'organisation et son expéditeur être rattaché à ce contact.
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
  buildConsentsFromCourierBody,
  buildConsentsRecordBody,
} from "../_shared/consentsLogic.ts";
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
const CONTACT_MUTATION_ACTIONS = new Set([
  "create",
  "update",
  "archive",
  "restore",
  "consents_record",
  "consents_from_courier",
]);

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
      .select("socle_org_id, name")
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

    // Consentements : le corps envoyé au Socle est composé ici, à partir d'un
    // payload minimal. `organizations.name` est le miroir du nom de la racine
    // Socle : c'est ce que l'écran affiche, donc la phrase consignée est celle
    // qui a été lue.
    let socleBody: Record<string, unknown> | undefined;
    if (action === "consents_record") {
      if (!isUuid(id)) return errorResponse("bad_request", "id de contact invalide (uuid attendu).", 400);
      const built = buildConsentsRecordBody(payload, (org?.name as string | null) ?? null);
      if (!built.ok) return errorResponse("bad_request", built.message, 400);
      socleBody = built.body as unknown as Record<string, unknown>;
    } else if (action === "consents_from_courier") {
      if (!isUuid(id)) return errorResponse("bad_request", "id de contact invalide (uuid attendu).", 400);
      const courierId = (payload as Record<string, unknown> | undefined)?.courier_id;
      if (!isUuid(courierId)) {
        return errorResponse("bad_request", "courier_id invalide (uuid attendu).", 400);
      }
      const { data: courier } = await admin
        .from("couriers")
        .select("id, received_at, created_at, consents")
        .eq("id", courierId)
        .eq("organization_id", organization_id)
        .maybeSingle();
      if (!courier) return errorResponse("courier_not_found", "Courrier introuvable.", 404);
      // Le report ne vaut que pour la personne rattachée comme expéditeur de
      // CE courrier : consigner la trace sur une autre fiche serait un faux.
      const { data: sender } = await admin
        .from("courier_participants")
        .select("id")
        .eq("courier_id", courierId)
        .eq("role", "sender")
        .eq("socle_contact_id", id)
        .limit(1)
        .maybeSingle();
      if (!sender) {
        return errorResponse(
          "contact_mismatch",
          "L'expéditeur de ce courrier n'est pas rattaché à ce contact.",
          409,
        );
      }
      const built = buildConsentsFromCourierBody(courier as {
        id: string;
        received_at: string | null;
        created_at: string | null;
        consents: unknown;
      });
      if (!built.ok) return errorResponse("bad_request", built.message, 400);
      if (built.body === null) {
        // Rien à reporter : ce n'est pas une erreur, le courrier n'a
        // simplement pas de trace (saisie agent, IMAP, antérieur à la colonne).
        return jsonResponse({ skipped: true, reason: "aucun_consentement" }, 200);
      }
      socleBody = built.body as unknown as Record<string, unknown>;
    }

    const built = buildSocleRequest(action, {
      id,
      payload: socleBody ?? payload,
      filters,
    });
    if (!built.ok) return errorResponse("bad_request", built.message, 400);

    const { status, body: responseBody } = await fetchContactsApi(apiKey, built.request, {
      socleOrgId: org?.socle_org_id as string | null,
    });
    return jsonResponse(responseBody, status);
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
