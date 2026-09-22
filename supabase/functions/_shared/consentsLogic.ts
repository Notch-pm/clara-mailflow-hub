/**
 * Logique pure de l'écriture des consentements RGPD au Socle
 * (`POST /v1/contacts/{id}/consents`) — aucun import Deno, testée par Vitest
 * dans src/test/socle/consents-logic.test.ts.
 *
 * Deux chemins, deux constructeurs :
 *  - `buildConsentsRecordBody` : consignation MANUELLE par un agent (formulaire
 *    papier reçu, retrait exprimé par courrier). Le navigateur n'envoie que
 *    `kind` et `granted` ; la phrase est composée ICI depuis le catalogue et
 *    le nom de l'organisation relu en base. Le Socle enregistre un fait et
 *    n'exige rien : un retrait de `traitement` (`granted: false`) se consigne
 *    comme le reste — c'est pourquoi `normalizeConsents` (garde du DÉPÔT, qui
 *    impose l'obligatoire) ne sert pas ici.
 *  - `buildConsentsFromCourierBody` : REPORT de la trace d'un courrier déposé
 *    au portail, au moment où l'agent rattache l'expéditeur à une fiche. Les
 *    phrases sont reprises TELLES QUELLES (ce sont celles que l'usager a lues
 *    ce jour-là), jamais recomposées, et la date est celle du recueil.
 *
 * Idempotence côté Socle : `(contact_id, kind, source_app, source_reference)`.
 * Le report porte l'id du courrier ; la consignation manuelle porte la
 * référence libre de l'agent, ou rien (chaque appel est alors un fait nouveau).
 */
import {
  consentStatement,
  isConsentKind,
  parseConsentRecords,
  type ConsentKind,
} from "./consents/catalog.ts";

/** Code sous lequel Clara se déclare au référentiel. Libre côté Socle. */
export const CONSENT_SOURCE_APP = "clara";

/** Limite du Socle (`validation.ts`) sur `source_reference`. */
const REFERENCE_MAX = 200;

export interface SocleConsentEntry {
  kind: ConsentKind;
  granted: boolean;
  statement: string;
}

/** Corps exact attendu par `POST /v1/contacts/{id}/consents`. */
export interface SocleConsentsBody {
  source_app: typeof CONSENT_SOURCE_APP;
  source_reference: string | null;
  collected_at: string;
  consents: SocleConsentEntry[];
}

export type ConsentsBodyResult =
  | { ok: true; body: SocleConsentsBody }
  | { ok: false; message: string };

const RECORD_KEYS = new Set(["answers", "collected_at", "reference"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Consignation manuelle : `{ answers: [{ kind, granted }], collected_at?, reference? }`.
 * `collected_at` (ISO) est la date qui fait foi au Socle — elle peut être
 * antérieure (formulaire papier consigné après coup) mais jamais future.
 */
export function buildConsentsRecordBody(
  payload: unknown,
  organismName: string | null | undefined,
  now: Date = new Date(),
): ConsentsBodyResult {
  if (!isPlainObject(payload)) return { ok: false, message: "payload : objet attendu." };

  const unknown = Object.keys(payload).filter((k) => !RECORD_KEYS.has(k));
  if (unknown.length > 0) {
    return {
      ok: false,
      message: `payload : clés inconnues (${unknown.join(", ")}) — le libellé est composé par le serveur.`,
    };
  }

  const answers = payload.answers;
  if (!Array.isArray(answers) || answers.length === 0) {
    return { ok: false, message: "answers : tableau non vide attendu." };
  }
  const seen = new Map<ConsentKind, boolean>();
  for (const [i, entry] of answers.entries()) {
    if (!isPlainObject(entry)) return { ok: false, message: `answers[${i}] : objet attendu.` };
    const extra = Object.keys(entry).filter((k) => k !== "kind" && k !== "granted");
    if (extra.length > 0) {
      return {
        ok: false,
        message: `answers[${i}] : seules les clés kind et granted sont acceptées `
          + `(${extra.join(", ")} refusée${extra.length > 1 ? "s" : ""} — le libellé est composé par le serveur).`,
      };
    }
    if (!isConsentKind(entry.kind)) {
      return { ok: false, message: `answers[${i}].kind : valeur hors catalogue.` };
    }
    if (typeof entry.granted !== "boolean") {
      return { ok: false, message: `answers[${i}].granted : booléen attendu.` };
    }
    if (seen.has(entry.kind)) {
      return { ok: false, message: `answers[${i}].kind : ${entry.kind} transmis deux fois.` };
    }
    seen.set(entry.kind, entry.granted);
  }

  let collectedAt = now.toISOString();
  if (payload.collected_at !== undefined && payload.collected_at !== null) {
    if (typeof payload.collected_at !== "string" || Number.isNaN(Date.parse(payload.collected_at))) {
      return { ok: false, message: "collected_at : date ISO 8601 attendue." };
    }
    const date = new Date(payload.collected_at);
    if (date.getTime() > now.getTime()) {
      return { ok: false, message: "collected_at : la date du recueil ne peut pas être future." };
    }
    collectedAt = date.toISOString();
  }

  let reference: string | null = null;
  if (payload.reference !== undefined && payload.reference !== null) {
    if (typeof payload.reference !== "string") {
      return { ok: false, message: "reference : texte ou null attendu." };
    }
    const trimmed = payload.reference.trim();
    if (trimmed.length > REFERENCE_MAX) {
      return { ok: false, message: `reference : ${REFERENCE_MAX} caractères au plus.` };
    }
    reference = trimmed === "" ? null : trimmed;
  }

  // Ordre du catalogue, mais seulement ce qui a été répondu : consigner un
  // seul consentement (un retrait du partage, par exemple) est un acte
  // complet — ne pas inventer une réponse pour l'autre.
  const consents: SocleConsentEntry[] = [];
  for (const kind of ["traitement", "partage"] as const) {
    if (!seen.has(kind)) continue;
    consents.push({ kind, granted: seen.get(kind)!, statement: consentStatement(kind, organismName) });
  }

  return {
    ok: true,
    body: { source_app: CONSENT_SOURCE_APP, source_reference: reference, collected_at: collectedAt, consents },
  };
}

export interface CourierConsentSource {
  id: string;
  received_at?: string | null;
  created_at?: string | null;
  consents: unknown;
}

export type CourierConsentsBodyResult =
  | { ok: true; body: SocleConsentsBody | null }
  | { ok: false; message: string };

/**
 * Report de la trace d'un courrier. `body: null` = rien à reporter (courrier
 * sans trace : saisie agent, IMAP, antérieur à la colonne) — ce n'est pas une
 * erreur, l'appelant n'a simplement rien à envoyer.
 */
export function buildConsentsFromCourierBody(courier: CourierConsentSource): CourierConsentsBodyResult {
  const trace = parseConsentRecords(courier.consents);
  if (trace.length === 0) return { ok: true, body: null };

  // La date du recueil : celle portée par la trace, sinon la réception du
  // courrier, sinon sa création. Jamais « maintenant » : le rattachement peut
  // venir des jours après le dépôt.
  const fromTrace = trace.find((c) => c.collected_at)?.collected_at ?? null;
  const fallback = [courier.received_at, courier.created_at]
    .find((d) => typeof d === "string" && !Number.isNaN(Date.parse(d))) ?? null;
  const collectedAt = fromTrace ?? fallback;
  if (!collectedAt) {
    return { ok: false, message: "Ce courrier ne porte aucune date de recueil exploitable." };
  }

  return {
    ok: true,
    body: {
      source_app: CONSENT_SOURCE_APP,
      source_reference: courier.id,
      collected_at: new Date(collectedAt).toISOString(),
      consents: trace.map(({ kind, granted, statement }) => ({ kind, granted, statement })),
    },
  };
}
