/**
 * Détection de doublons dans le référentiel de contacts (Socle) : construction
 * du payload de rapprochement et vocabulaire des motifs. Logique pure, sans
 * dépendance React/Supabase (l'appel vit dans
 * `socleContactService.findPotentialDuplicates`).
 *
 * Le rapprochement lui-même appartient au Socle (`POST /v1/contacts/match`,
 * pg_trgm + unaccent côté SQL) : Clara n'a plus de moteur local. Elle décrit
 * l'identité saisie, le Socle répond par des candidats classés avec leurs
 * motifs. Les angles morts de l'ancienne approche (doublon au téléphone seul,
 * faute sur le début du nom, accent divergent) sont levés de ce fait.
 */
import type { SocleContactType } from "@/services/socleContactService";

/** Saisie en cours à rapprocher : formulaire contact complet OU participant de courrier. */
export interface ContactDraft {
  /** Restreint la recherche à ce type quand il est connu (formulaire contact). */
  contact_type?: SocleContactType | null;
  first_name?: string | null;
  /** Nom de naissance, ou « Nom / Raison sociale » côté participant. */
  last_name?: string | null;
  usage_name?: string | null;
  legal_name?: string | null;
  siret?: string | null;
  birth_date?: string | null;
  email?: string | null;
  /** Participant : un seul champ téléphone, nature inconnue. */
  phone?: string | null;
  mobile_phone?: string | null;
  landline_phone?: string | null;
}

/** Motifs renvoyés par le Socle — vocabulaire du contrat contacts-api. */
export type DuplicateReason =
  | "email"
  | "phone"
  | "siret"
  | "birth_date"
  | "name_exact"
  | "name_similar";

export const DUPLICATE_REASON_LABELS: Record<DuplicateReason, string> = {
  email: "Même email",
  phone: "Même téléphone",
  siret: "Même SIRET",
  birth_date: "Même date de naissance",
  name_exact: "Même nom",
  name_similar: "Nom très proche",
};

/** Bornes de `POST /v1/contacts/match` — au-delà, le Socle répond 400. */
const MATCH_MAX_LIMIT = 20;
const MATCH_MAX_PHONES = 10;

/**
 * Longueur minimale d'un nom avant d'interroger le référentiel. Garde-fou de
 * politesse côté client (le Socle accepterait une seule lettre) : inutile de
 * rapprocher sur « D » au premier caractère frappé.
 */
const MIN_NAME_LENGTH = 2;
/** En deçà, ce n'est pas encore un numéro de téléphone mais une saisie en cours. */
const MIN_PHONE_DIGITS = 6;

export function normalizeEmail(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function trimmed(value: string | null | undefined): string {
  return (value ?? "").trim();
}

/** Nom assez fourni pour valoir un critère de rapprochement. */
function usableName(value: string | null | undefined): string {
  const t = trimmed(value);
  return t.length >= MIN_NAME_LENGTH ? t : "";
}

/**
 * Numéros de la saisie, au format libre : le Socle les normalise lui-même
 * (miroir de sa fonction SQL `normalize_phone`), donc on ne touche à rien —
 * on écarte seulement ce qui ne peut pas encore être un numéro.
 */
function usablePhones(draft: ContactDraft): string[] {
  const raw = [draft.phone, draft.mobile_phone, draft.landline_phone]
    .map(trimmed)
    .filter((p) => p.replace(/\D/g, "").length >= MIN_PHONE_DIGITS);
  return [...new Set(raw)].slice(0, MATCH_MAX_PHONES);
}

/** SIRET réduit à ses chiffres — le Socle compare sur les chiffres seuls. */
function usableSiret(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

/**
 * Payload de `POST /v1/contacts/match`. Le Socle applique une **whitelist
 * stricte** des clés (une clé inconnue → 400) : n'émettre que ce qu'il connaît,
 * et omettre ce qui est vide plutôt que d'envoyer des nulls.
 */
export function buildMatchPayload(
  draft: ContactDraft,
  opts: { excludeIds?: string[]; limit?: number } = {},
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  if (draft.contact_type) payload.contact_type = draft.contact_type;

  // Le prénom ne rapproche rien seul, mais affine le score et sert de
  // garde-fou aux homonymes de nom de famille côté Socle.
  const first = trimmed(draft.first_name);
  if (first) payload.first_name = first;

  for (const key of ["last_name", "usage_name", "legal_name"] as const) {
    const value = usableName(draft[key]);
    if (value) payload[key] = value;
  }

  const email = normalizeEmail(draft.email);
  if (email.includes("@")) payload.email = email;

  const siret = usableSiret(draft.siret);
  if (siret) payload.siret = siret;

  const birthDate = trimmed(draft.birth_date);
  if (birthDate) payload.birth_date = birthDate;

  const phones = usablePhones(draft);
  if (phones.length) payload.phones = phones;

  if (opts.excludeIds?.length) payload.exclude_ids = [...new Set(opts.excludeIds)];
  if (opts.limit !== undefined) {
    payload.limit = Math.min(Math.max(Math.round(opts.limit), 1), MATCH_MAX_LIMIT);
  }

  return payload;
}

/**
 * Vrai si la saisie porte assez d'information pour interroger le référentiel.
 * Miroir de la règle du Socle : au moins un critère parmi email, téléphone,
 * SIRET, nom de famille, nom d'usage, raison sociale ou date de naissance — un
 * **prénom seul ne rapproche rien**. Sans ce garde-fou, la saisie partirait en
 * 400.
 */
export function hasDuplicateSignal(draft: ContactDraft): boolean {
  const payload = buildMatchPayload(draft);
  return (
    payload.email !== undefined ||
    payload.phones !== undefined ||
    payload.siret !== undefined ||
    payload.last_name !== undefined ||
    payload.usage_name !== undefined ||
    payload.legal_name !== undefined ||
    payload.birth_date !== undefined
  );
}
