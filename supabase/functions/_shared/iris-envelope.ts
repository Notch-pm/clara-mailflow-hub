// Connecteur Iris — construction de l'enveloppe d'ingestion et lecture des
// réponses. Logique PURE, testée par Vitest (src/test/iris/iris-envelope.test.ts) :
// aucune dépendance Deno, aucun appel réseau.
//
// Iris est propriétaire exclusif des demandes d'usagers de la gamme. Clara y
// dépose une action de courrier fondée sur une DÉMARCHE du référentiel, puis en
// suit l'état — elle ne la pilote pas. Contrat : `POST /v1/requests`
// (public-api Iris 2.1.0, tag « Ingestion »).
//
// Trois règles du contrat gouvernent ce module :
//   • `socle_procedure_id` est OBLIGATOIRE — Iris ne gère aucune demande libre.
//     Une action sans démarche du référentiel reste donc chez Clara, et ce
//     n'est pas une erreur : c'est la frontière entre les deux produits.
//     Clara ne crée plus de telles actions depuis le 2026-09-11 ; la garde
//     couvre encore les tickets d'avant et les démarches Arpège.
//   • le périmètre est porté par la CLÉ, jamais par le payload : le
//     `socle_root_organization_id` déclaré est vérifié côté Iris (403 en cas
//     d'écart). On envoie donc celui de l'intégration, pas celui du tenant.
//   • une pièce jointe se DÉPOSE d'abord (`POST /v1/uploads`), puis se
//     référence par son `upload_id` (contrat 2.0.0). Iris ne vient jamais lire
//     un fichier chez Clara, et un contenu inline vaut 400.

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

/**
 * Référence d'une pièce DÉJÀ déposée sur `POST /v1/uploads` (contrat 2.0.0).
 * Iris ne va jamais chercher un fichier chez Clara : le mode « URL signée » a
 * été retiré, et un contenu inline vaut 400.
 */
export interface IrisAttachmentRef {
  upload_id: string;
  /** Clé MACHINE du champ de formulaire qui réclame la pièce (`rib`, `statuts`…). */
  form_field_key?: string;
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
  attachments?: IrisAttachmentRef[];
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

// ── Pièces jointes : ce qui part, et ce qui reste ───────────────────────────
//
// Périmètre arrêté par le PO : SEULES partent les pièces que le formulaire de
// la démarche réclame — « Statuts de l'association », « Relevé d'identité
// bancaire »… L'agent les a cochées dans le dialogue de demande, elles vivent
// dans `socle_data.pieces_jointes`, indexées par **id** de champ. Iris, lui,
// attend la **clé machine** (`form_field_key`) : le pont se fait par le
// `form_schema` de la démarche.

/** Limites du contrat (`POST /v1/uploads`, `attachments`). */
export const IRIS_MAX_ATTACHMENTS = 50;
export const IRIS_MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** Ce que Clara sait d'un document de courrier (table `courier_documents`). */
export interface CourierDocumentRow {
  id: string;
  storage_key?: string | null;
  file_name?: string | null;
  mime_type?: string | null;
  file_size?: number | null;
}

/** Une pièce à déposer : le fichier, et le champ de formulaire qui la réclame. */
export interface PlannedAttachment {
  documentId: string;
  storageKey: string;
  fileName: string;
  mimeType: string | null;
  /** `null` = pièce « hors champ » : Iris l'accepte, elle n'est rattachée à rien. */
  formFieldKey: string | null;
  /** Libellé du champ — pour nommer à l'agent une pièce qui n'est pas passée. */
  fieldLabel: string | null;
}

/** Une pièce qui ne partira pas, et pourquoi — en français, pour l'agent. */
export interface DroppedAttachment {
  fileName: string;
  fieldLabel: string | null;
  reason: string;
}

export interface AttachmentPlan {
  items: PlannedAttachment[];
  dropped: DroppedAttachment[];
}

/**
 * Champs « pièce jointe » du formulaire, par id : leur clé machine et leur
 * libellé. Le schéma mêle sections et champs au même niveau (contrat Socle).
 */
export function attachmentFieldsOf(
  formSchema: unknown,
): Map<string, { key: string; label: string }> {
  const out = new Map<string, { key: string; label: string }>();
  const content = (formSchema as { content?: unknown } | null)?.content;
  if (!Array.isArray(content)) return out;

  const visit = (node: unknown) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return;
    const n = node as {
      kind?: string;
      fields?: unknown;
      id?: unknown;
      key?: unknown;
      label?: unknown;
      type?: unknown;
    };
    if (n.kind === "section") {
      if (Array.isArray(n.fields)) n.fields.forEach(visit);
      return;
    }
    const id = trimmed(n.id);
    if (n.type === "attachment" && id) {
      out.set(id, { key: trimmed(n.key), label: trimmed(n.label) });
    }
  };
  content.forEach(visit);
  return out;
}

/**
 * Les pièces à déposer, dans l'ordre du formulaire, et celles qu'on laisse —
 * chacune avec son motif. Rien n'est deviné : un document que Clara ne
 * retrouve pas, ou qu'Iris refuserait de toute façon (25 Mo, 50 pièces), est
 * écarté ICI, avant le réseau, avec de quoi le dire.
 */
export function planIrisAttachments(input: {
  socleData: unknown;
  formSchema: unknown;
  documents: CourierDocumentRow[];
}): AttachmentPlan {
  const items: PlannedAttachment[] = [];
  const dropped: DroppedAttachment[] = [];

  const pieces = parseSocleData(input.socleData).pieces_jointes;
  if (!pieces || typeof pieces !== "object" || Array.isArray(pieces)) {
    return { items, dropped };
  }

  const fields = attachmentFieldsOf(input.formSchema);
  const byId = new Map(input.documents.map((d) => [d.id, d]));
  const seen = new Set<string>();

  for (const [fieldId, docIds] of Object.entries(pieces)) {
    if (!Array.isArray(docIds)) continue;
    const field = fields.get(fieldId) ?? null;
    const fieldLabel = field?.label || null;

    for (const rawId of docIds) {
      const docId = trimmed(rawId);
      // Un même document coché sur deux champs ne se dépose qu'une fois :
      // Iris refuse (400) un upload_id référencé deux fois, et deux dépôts du
      // même fichier feraient un doublon dans le dossier.
      if (!docId || seen.has(docId)) continue;
      seen.add(docId);

      const doc = byId.get(docId);
      const storageKey = trimmed(doc?.storage_key);
      if (!doc || !storageKey) {
        dropped.push({
          fileName: trimmed(doc?.file_name) || "pièce sélectionnée",
          fieldLabel,
          reason: "document introuvable dans Clara",
        });
        continue;
      }

      const fileName = trimmed(doc.file_name) || "piece-jointe";
      const size = typeof doc.file_size === "number" ? doc.file_size : null;
      if (size !== null && size > IRIS_MAX_UPLOAD_BYTES) {
        dropped.push({ fileName, fieldLabel, reason: "au-delà de 25 Mo" });
        continue;
      }
      if (items.length >= IRIS_MAX_ATTACHMENTS) {
        dropped.push({ fileName, fieldLabel, reason: "au-delà de 50 pièces par demande" });
        continue;
      }

      items.push({
        documentId: doc.id,
        storageKey,
        fileName,
        mimeType: trimmed(doc.mime_type) || null,
        // Champ disparu du formulaire depuis la saisie (démarche resynchronisée) :
        // la pièce part quand même, « hors champ ». Perdre le fichier serait pire.
        formFieldKey: field?.key || null,
        fieldLabel,
      });
    }
  }

  return { items, dropped };
}

/** Les pièces déposées entrent dans l'enveloppe — jamais leur contenu. */
export function withIrisAttachments(
  envelope: IrisEnvelope,
  refs: IrisAttachmentRef[],
): IrisEnvelope {
  return refs.length > 0 ? { ...envelope, attachments: refs } : envelope;
}

/**
 * Refus DÉFINITIF d'un fichier : réessayer ne changerait rien (format hors
 * liste, extension incohérente, trop gros, envoi malformé). La demande part
 * alors SANS cette pièce — un fichier refusé n'est pas une panne. Tout le
 * reste (401, 403, 429, 5xx, réseau) est passager : on ne dépose rien, l'agent
 * renvoie.
 */
export function isDefiniteUploadRefusal(status: number): boolean {
  return status === 400 || status === 413 || status === 415 || status === 422;
}

/** Motif de refus d'un fichier, dit à l'agent (jamais le jargon HTTP seul). */
export function uploadRefusalMessage(status: number, body: unknown): string {
  const message = trimmed((body as { error?: { message?: string } } | null)?.error?.message);
  switch (status) {
    case 413:
      return "fichier au-delà de 25 Mo";
    case 415:
      return "format refusé par Iris (PDF, JPEG, PNG, WebP, HEIC, GIF, .docx, .xlsx, .odt, .ods)";
    case 422:
      return "extension du nom incohérente avec le contenu du fichier";
    case 429:
      return "trop de dépôts dans la minute chez Iris";
    default:
      return message || `Iris a répondu ${status}`;
  }
}

/**
 * Ce que l'agent lit sur le ticket quand des pièces réclamées ne sont pas
 * parties. `null` = rien à signaler : on n'affirme jamais l'inverse, un ticket
 * déposé avant ce chemin n'a simplement rien à dire là-dessus.
 */
export function attachmentsRefusedNote(dropped: DroppedAttachment[]): string | null {
  if (dropped.length === 0) return null;
  const parts = dropped.map((d) =>
    `${d.fieldLabel ? `${d.fieldLabel} — ` : ""}${d.fileName} (${d.reason})`
  );
  return `${dropped.length > 1 ? "Pièces non transmises" : "Pièce non transmise"} à Iris : ${
    parts.join(" ; ")
  }.`;
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

  // Pièces jointes : ABSENTES ICI par construction. Elles n'entrent dans
  // l'enveloppe qu'une fois DÉPOSÉES chez Iris (`withIrisAttachments`), et on
  // ne dépose rien tant qu'on ne sait pas que l'enveloppe tient — sinon un
  // refus de démarche obsolète laisserait des fichiers orphelins en zone
  // d'attente.

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
 * Ce qu'une lecture d'Iris écrit sur le ticket. Deux chemins la font — la
 * réconciliation nocturne et le rafraîchissement à l'ouverture de l'onglet — et
 * ils doivent écrire EXACTEMENT la même chose : sinon l'état affiché dépendrait
 * de qui l'a lu en dernier.
 *
 * `iris_last_error` est remis à null : il ne parle que du DÉPÔT, et une lecture
 * réussie prouve que la demande est bien arrivée. À l'inverse, une lecture qui
 * échoue ne doit jamais l'écrire — ce serait proposer « Renvoyer » pour une
 * demande déjà déposée.
 */
export function irisTicketPatch(item: IrisRequestDto, syncedAt: string) {
  return {
    iris_request_id: item.id ?? null,
    iris_reference: item.reference ?? null,
    iris_status: isIrisStatus(item.status) ? item.status : null,
    iris_version: typeof item.version === "number" ? item.version : null,
    iris_url: item.url ?? null,
    iris_synced_at: syncedAt,
    iris_last_error: null,
  };
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
