// Connecteur Iris — construction de l'enveloppe d'ingestion et lecture des
// réponses. Logique PURE, testée par Vitest (src/test/iris/iris-envelope.test.ts) :
// aucune dépendance Deno, aucun appel réseau.
//
// Iris est propriétaire exclusif des demandes d'usagers de la gamme. Clara y
// dépose une action de courrier fondée sur une DÉMARCHE du référentiel, puis en
// suit l'état — elle ne la pilote pas. Contrat : `POST /v1/requests`
// (public-api Iris 1.1.0, tag « Ingestion »).
//
// Deux règles du contrat gouvernent ce module :
//   • `socle_procedure_id` est OBLIGATOIRE — Iris ne gère aucune demande libre.
//     Une action sans démarche du référentiel reste donc chez Clara, et ce
//     n'est pas une erreur : c'est la frontière entre les deux produits.
//   • le périmètre est porté par la CLÉ, jamais par le payload : le
//     `socle_root_organization_id` déclaré est vérifié côté Iris (403 en cas
//     d'écart). On envoie donc celui de l'intégration, pas celui du tenant.

/** Statuts Iris — liste FERMÉE du contrat. Ne jamais en inventer. */
export const IRIS_STATUSES = [
  "a_traiter",
  "en_instruction",
  "en_attente",
  "annulee",
  "resolue_positive",
  "resolue_negative",
  "archivee",
] as const;
export type IrisStatus = (typeof IRIS_STATUSES)[number];

export function isIrisStatus(value: unknown): value is IrisStatus {
  return typeof value === "string" && (IRIS_STATUSES as readonly string[]).includes(value);
}

/** Enveloppe d'ingestion (sous-ensemble utilisé par Clara). */
export interface IrisEnvelope {
  source_system: "clara";
  external_id: string;
  idempotency_key: string;
  socle_root_organization_id: string;
  socle_organization_id?: string;
  socle_procedure_id: string;
  socle_contact_id?: string;
  subject: string;
  body?: string;
  requester?: Record<string, unknown>;
  form_data?: Record<string, unknown>;
  context?: {
    channel?: string;
    received_at?: string;
    external_url?: string;
    metadata?: Record<string, unknown>;
  };
  links?: Array<{ type: string; id: string; url?: string; label?: string }>;
}

/** Demande telle que servie par Iris (champs inconnus tolérés — contrat additif). */
export interface IrisRequestDto {
  id?: string;
  reference?: string | null;
  status?: string | null;
  version?: number | null;
  external_id?: string | null;
  url?: string | null;
  updated_at?: string | null;
}

/** Bloc rangé dans `action_tickets.socle_data` par le formulaire de démarche. */
export interface SocleDemandeData {
  demandeur?: { audience?: string | null; values?: Record<string, string> } | null;
  form?: Array<{ key?: string; value?: unknown }> | null;
  pieces_jointes?: Record<string, string[]> | null;
}

export interface EnvelopeInput {
  ticket: {
    id: string;
    title?: string | null;
    description?: string | null;
    socle_data?: unknown;
    iris_idempotency_key: string;
  };
  courier: {
    id: string;
    chrono?: string | null;
    subject?: string | null;
    channel?: string | null;
    received_at?: string | null;
    /** UUID SOCLE de l'organisation destinataire (pas l'id du miroir Clara). */
    socle_organization_socle_id?: string | null;
  };
  procedure: {
    socle_id?: string | null;
    name?: string | null;
    obsoleted_at?: string | null;
  } | null;
  /** Contact Socle rapproché sur l'expéditeur du courrier, s'il existe. */
  socleContactId?: string | null;
  integration: { socle_root_org_id?: string | null };
  /** Origine publique de Clara, pour le permalien (APP_ORIGIN). */
  appOrigin?: string | null;
}

export type EnvelopeResult =
  | { ok: true; envelope: IrisEnvelope }
  | { ok: false; message: string };

const MAX_SUBJECT = 500;

function trimmed(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function parseSocleData(raw: unknown): SocleDemandeData {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as SocleDemandeData;
}

/** Réponses au formulaire, indexées par CLÉ MACHINE (`key`) comme l'exige Iris. */
export function formDataFromSocleData(raw: unknown): Record<string, unknown> | undefined {
  const entries = parseSocleData(raw).form;
  if (!Array.isArray(entries)) return undefined;
  const out: Record<string, unknown> = {};
  for (const entry of entries) {
    const key = trimmed(entry?.key);
    if (!key || entry?.value === undefined || entry?.value === null) continue;
    out[key] = entry.value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Identité DÉCLARÉE du demandeur, conservée intégralement : c'est une pièce du
 * dossier, pas un doublon du contact. `audience` est conservée telle quelle —
 * elle dit à quel titre la personne se présente.
 */
export function requesterFromSocleData(raw: unknown): Record<string, unknown> | undefined {
  const demandeur = parseSocleData(raw).demandeur;
  if (!demandeur) return undefined;
  const values = demandeur.values ?? {};
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    const value = trimmed(v);
    if (value) cleaned[k] = value;
  }
  const audience = trimmed(demandeur.audience);
  if (audience) cleaned.audience = audience;
  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
}

/**
 * Enveloppe prête à poster, ou refus motivé — message destiné à l'agent, en
 * français. On refuse AVANT le réseau tout ce qu'Iris refuserait : inutile de
 * consommer un appel pour se faire dire 400.
 */
export function buildIrisEnvelope(input: EnvelopeInput): EnvelopeResult {
  const { ticket, courier, procedure, integration } = input;

  const root = trimmed(integration.socle_root_org_id);
  if (!root) {
    return {
      ok: false,
      message:
        "Intégration Iris incomplète : l'organisation racine du référentiel n'est pas renseignée.",
    };
  }

  const socleProcedureId = trimmed(procedure?.socle_id);
  if (!socleProcedureId) {
    return {
      ok: false,
      // Cas nominal d'une demande libre : ce n'est pas un incident.
      message:
        "Cette action n'est pas fondée sur une démarche du référentiel : elle reste dans Clara.",
    };
  }
  if (procedure?.obsoleted_at) {
    return {
      ok: false,
      message: "La démarche de cette action est obsolète : Iris la refuserait.",
    };
  }

  const socleContactId = trimmed(input.socleContactId);
  const requester = requesterFromSocleData(ticket.socle_data);
  if (!socleContactId && !requester) {
    return {
      ok: false,
      message:
        "Aucun demandeur : rapprochez l'expéditeur d'un contact du référentiel, ou renseignez le formulaire de la démarche.",
    };
  }

  const subject = (trimmed(ticket.title) || trimmed(procedure?.name) || "Demande")
    .slice(0, MAX_SUBJECT);
  const body = trimmed(ticket.description);
  const origin = trimmed(input.appOrigin).replace(/\/+$/, "");
  const permalink = origin ? `${origin}/courrier/${courier.id}` : undefined;
  const courierLabel = trimmed(courier.chrono) || courier.id;

  const envelope: IrisEnvelope = {
    source_system: "clara",
    // L'id du TICKET, jamais celui du courrier : un courrier peut engendrer
    // plusieurs demandes.
    external_id: ticket.id,
    idempotency_key: ticket.iris_idempotency_key,
    socle_root_organization_id: root,
    socle_procedure_id: socleProcedureId,
    subject,
  };

  const socleOrgId = trimmed(courier.socle_organization_socle_id);
  if (socleOrgId) envelope.socle_organization_id = socleOrgId;
  if (socleContactId) envelope.socle_contact_id = socleContactId;
  if (body) envelope.body = body;
  if (requester) envelope.requester = requester;

  const formData = formDataFromSocleData(ticket.socle_data);
  if (formData) envelope.form_data = formData;

  const context: NonNullable<IrisEnvelope["context"]> = {};
  const channel = trimmed(courier.channel);
  if (channel) context.channel = channel;
  // Date de réception D'ORIGINE du courrier, pas la date d'ingestion.
  const receivedAt = trimmed(courier.received_at);
  if (receivedAt) context.received_at = new Date(receivedAt).toISOString();
  if (permalink) context.external_url = permalink;
  const metadata: Record<string, unknown> = { courier_id: courier.id };
  if (trimmed(courier.chrono)) metadata.courier_chrono = trimmed(courier.chrono);
  if (trimmed(courier.subject)) metadata.courier_subject = trimmed(courier.subject);
  context.metadata = metadata;
  if (Object.keys(context).length > 0) envelope.context = context;

  envelope.links = [{
    type: "courrier",
    id: courierLabel,
    ...(permalink ? { url: permalink } : {}),
    ...(trimmed(courier.subject) ? { label: trimmed(courier.subject) } : {}),
  }];

  // Pièces jointes : VOLONTAIREMENT absentes. Le worker de copie d'Iris n'est
  // pas actif (« n'envoyez pas encore de pièces en production », contrat 1.1.0) ;
  // elles resteraient en `copy_status: pending`. `socle_data.pieces_jointes`
  // garde la sélection de l'agent, prête à être transmise le jour venu.

  return { ok: true, envelope };
}

/**
 * Iris ENVELOPPE ses réponses : un dépôt rend `{ created, request }`, une
 * liste rend `{ requests: [...] }`. On ne code que sur ces clés documentées —
 * une réponse d'une autre forme n'est pas « vide », elle est illisible, et
 * doit le dire (`null`) plutôt que de passer pour un silence.
 */
export function irisRequestFromBody(body: unknown): IrisRequestDto | null {
  const request = (body as { request?: unknown } | null)?.request;
  if (!request || typeof request !== "object" || Array.isArray(request)) return null;
  return request as IrisRequestDto;
}

export function irisRequestsFromBody(body: unknown): IrisRequestDto[] | null {
  const requests = (body as { requests?: unknown } | null)?.requests;
  return Array.isArray(requests) ? (requests as IrisRequestDto[]) : null;
}

/**
 * Une mise à jour ne s'applique que si sa version DÉPASSE celle connue : la
 * version Iris est monotone, ce test absorbe rejeux et arrivées en désordre.
 * Une demande encore sans version connue est toujours appliquée.
 */
export function shouldApplyIrisUpdate(
  known: number | null | undefined,
  incoming: number | null | undefined,
): boolean {
  if (typeof incoming !== "number" || !Number.isFinite(incoming)) return false;
  if (typeof known !== "number" || !Number.isFinite(known)) return true;
  return incoming > known;
}

/**
 * Message d'échec destiné à l'agent : il doit dire quoi faire. Le corps servi
 * par Iris est déjà en français (`{ error: { code, message } }`) — on le
 * reprend, en le situant pour les cas où il ne suffit pas.
 */
export function irisErrorMessage(status: number, body: unknown): string {
  const message = trimmed(
    (body as { error?: { message?: string } } | null)?.error?.message,
  );
  switch (status) {
    case 400:
      return message || "Demande refusée par Iris : enveloppe invalide.";
    case 401:
      return "Clé d'intégration Iris invalide, révoquée ou expirée — à renouveler par un administrateur Iris.";
    case 403:
      return message ||
        "Périmètre refusé par Iris : la clé ne couvre pas cette organisation, ou l'intégration est suspendue.";
    case 409:
      return "Une demande différente existe déjà dans Iris pour cette action : rien n'a été écrasé.";
    case 404:
      return "Demande introuvable dans Iris (ou hors du périmètre de la clé).";
    default:
      return message || `Iris a répondu ${status}.`;
  }
}
