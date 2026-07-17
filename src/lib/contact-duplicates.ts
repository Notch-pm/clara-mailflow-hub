/**
 * Détection de doublons potentiels dans le référentiel de contacts (Socle) :
 * normalisation des identités saisies, construction des fragments de recherche
 * et rapprochement d'une saisie avec une fiche existante. Logique pure, sans
 * dépendance React/Supabase (les appels au Socle vivent dans
 * `socleContactService.findPotentialDuplicates`).
 *
 * Contrainte forte de l'API contacts du Socle : la liste ne filtre que sur
 * `search` (ilike sur `display_name`, donc sensible aux accents) et `email`
 * (égalité exacte). Il n'existe ni filtre téléphone ni recherche floue côté
 * serveur : on ramène donc un jeu de candidats via des fragments de nom, puis
 * on rapproche ici. D'où les angles morts documentés dans
 * `docs/features.md` (doublon au téléphone seul, faute de frappe sur les 4
 * premières lettres du nom).
 */
import type { SocleContact, SocleContactType } from "@/services/socleContactService";

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

/** Une date de naissance partagée ne fait pas un doublon : elle ne fait que renforcer. */
const BOOSTER_REASONS: DuplicateReason[] = ["birth_date"];

const REASON_SCORES: Record<Exclude<DuplicateReason, "name_similar">, number> = {
  email: 100,
  siret: 100,
  phone: 70,
  name_exact: 60,
  birth_date: 30,
};

/** En deçà, deux noms proches sont surtout deux noms différents. */
const NAME_SIMILARITY_THRESHOLD = 0.82;
/** Sous cette longueur, la distance d'édition n'a plus de pouvoir discriminant. */
const MIN_LENGTH_FOR_SIMILARITY = 5;

// ── Normalisation ───────────────────────────────────────────────────────────

/** Minuscules, sans accent ni ponctuation, espaces normalisés. */
export function normalizeText(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function normalizeEmail(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

/**
 * Numéro comparable : chiffres seuls, indicatif France et 0 initial retirés.
 * `+33 6 12 34 56 78`, `0033612345678` et `06 12 34 56 78` donnent `612345678`.
 * Les numéros étrangers sont comparés sur leurs chiffres bruts.
 */
export function normalizePhone(value: string | null | undefined): string {
  const digits = (value ?? "").replace(/\D/g, "");
  if (digits.length < 6) return "";
  let national = digits;
  if (national.startsWith("0033")) national = national.slice(4);
  else if (national.startsWith("33") && national.length === 11) national = national.slice(2);
  if (national.length === 10 && national.startsWith("0")) national = national.slice(1);
  return national;
}

export function normalizeSiret(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

// ── Similarité ──────────────────────────────────────────────────────────────

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    const current = [i + 1];
    for (let j = 0; j < b.length; j++) {
      const cost = a[i] === b[j] ? 0 : 1;
      current.push(Math.min(current[j] + 1, previous[j + 1] + 1, previous[j] + cost));
    }
    previous = current;
  }
  return previous[b.length];
}

/** 1 = identique, 0 = tout diffère (distance d'édition rapportée à la longueur). */
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const max = Math.max(a.length, b.length);
  return 1 - levenshtein(a, b) / max;
}

// ── Clés de nom ─────────────────────────────────────────────────────────────

interface NameSource {
  first_name?: string | null;
  last_name?: string | null;
  usage_name?: string | null;
  legal_name?: string | null;
}

function uniqueNonEmpty(values: string[]): string[] {
  return [...new Set(values.filter((v) => v.trim() !== ""))];
}

/**
 * Clés comparables d'une identité, séparées personne / structure.
 *
 * Personne : « <nom> <prénom> » pour le nom de naissance ET le nom d'usage —
 * le Socle calcule `display_name` à partir de `usage_name` en priorité, donc
 * deux fiches de la même personne peuvent ne partager que l'un des deux.
 * Sans prénom saisi, le nom seul alimente les deux familles de clés : le champ
 * « Nom / Raison sociale » d'un participant peut désigner l'un comme l'autre.
 */
function nameKeys(src: NameSource): { person: string[]; org: string[] } {
  const first = normalizeText(src.first_name);
  const families = uniqueNonEmpty([normalizeText(src.usage_name), normalizeText(src.last_name)]);
  const person = first ? families.map((f) => `${f} ${first}`) : [];
  const org = [normalizeText(src.legal_name)];
  if (!first) {
    person.push(...families);
    org.push(...families);
  }
  return { person: uniqueNonEmpty(person), org: uniqueNonEmpty(org) };
}

/** Meilleure similarité entre deux jeux de clés (0 si l'un est vide). */
function bestSimilarity(a: string[], b: string[]): number {
  let best = 0;
  for (const x of a) {
    for (const y of b) {
      if (x.length < MIN_LENGTH_FOR_SIMILARITY || y.length < MIN_LENGTH_FOR_SIMILARITY) continue;
      best = Math.max(best, similarity(x, y));
    }
  }
  return best;
}

// ── Rapprochement ───────────────────────────────────────────────────────────

export interface DuplicateMatch {
  reasons: DuplicateReason[];
  /** Sert au classement, pas à un seuil : un seul motif suffit à proposer la fiche. */
  score: number;
}

function draftPhones(draft: ContactDraft): string[] {
  return uniqueNonEmpty(
    [draft.phone, draft.mobile_phone, draft.landline_phone].map((p) => normalizePhone(p)),
  );
}

function contactPhones(contact: SocleContact): string[] {
  return uniqueNonEmpty([contact.mobile_phone, contact.landline_phone].map((p) => normalizePhone(p)));
}

/**
 * Rapproche une saisie d'une fiche existante. `null` = aucun motif de doublon.
 * Une date de naissance identique seule ne suffit jamais.
 */
export function matchContact(draft: ContactDraft, contact: SocleContact): DuplicateMatch | null {
  const reasons: DuplicateReason[] = [];
  let score = 0;

  const draftEmail = normalizeEmail(draft.email);
  if (draftEmail && draftEmail === normalizeEmail(contact.email)) {
    reasons.push("email");
    score += REASON_SCORES.email;
  }

  const phones = new Set(contactPhones(contact));
  if (draftPhones(draft).some((p) => phones.has(p))) {
    reasons.push("phone");
    score += REASON_SCORES.phone;
  }

  const draftSiret = normalizeSiret(draft.siret);
  if (draftSiret && draftSiret === normalizeSiret(contact.siret)) {
    reasons.push("siret");
    score += REASON_SCORES.siret;
  }

  const draftKeys = nameKeys(draft);
  const contactKeys = nameKeys(contact);
  const exactName =
    draftKeys.person.some((k) => contactKeys.person.includes(k)) ||
    draftKeys.org.some((k) => contactKeys.org.includes(k));
  if (exactName) {
    reasons.push("name_exact");
    score += REASON_SCORES.name_exact;
  } else {
    const sim = Math.max(
      bestSimilarity(draftKeys.person, contactKeys.person),
      bestSimilarity(draftKeys.org, contactKeys.org),
    );
    if (sim >= NAME_SIMILARITY_THRESHOLD) {
      reasons.push("name_similar");
      score += Math.round(45 * sim);
    }
  }

  const draftBirth = (draft.birth_date ?? "").trim();
  if (draftBirth && draftBirth === (contact.birth_date ?? "").trim()) {
    reasons.push("birth_date");
    score += REASON_SCORES.birth_date;
  }

  if (!reasons.some((r) => !BOOSTER_REASONS.includes(r))) return null;
  return { reasons, score };
}

// ── Fragments de recherche ──────────────────────────────────────────────────

/** Longueur des préfixes cherchés : assez court pour absorber une faute de fin de nom. */
const FAMILY_FRAGMENT_LENGTH = 4;
const LEGAL_FRAGMENT_LENGTH = 6;
const MAX_FRAGMENTS = 3;

/**
 * Fragment brut (accents conservés) : `search` est un ilike côté Socle, donc
 * insensible à la casse mais PAS aux accents — normaliser ici ne trouverait
 * plus « Éric ».
 */
function rawFragment(value: string | null | undefined, length: number): string {
  const trimmed = (value ?? "").trim();
  if (trimmed.length < 2) return "";
  return Array.from(trimmed).slice(0, length).join("");
}

/**
 * Fragments à passer en `search` pour ramener les candidats. Le préfixe du nom
 * rattrape les fautes de frappe en fin de nom (Dupont/Dupond) ; le prénom est
 * cherché tel quel car `display_name` vaut « NOM Prénom » — c'est le filet qui
 * rattrape une faute au début du nom.
 */
export function duplicateSearchFragments(draft: ContactDraft): string[] {
  const fragments: string[] = [];
  const push = (value: string) => {
    if (value && !fragments.includes(value)) fragments.push(value);
  };
  push(rawFragment(draft.last_name, FAMILY_FRAGMENT_LENGTH));
  push(rawFragment(draft.usage_name, FAMILY_FRAGMENT_LENGTH));
  push(rawFragment(draft.legal_name, LEGAL_FRAGMENT_LENGTH));
  const first = (draft.first_name ?? "").trim();
  if (first.length >= 3) push(first);
  return fragments.slice(0, MAX_FRAGMENTS);
}

/** Vrai si la saisie porte assez d'information pour interroger le référentiel. */
export function hasDuplicateSignal(draft: ContactDraft): boolean {
  if (duplicateSearchFragments(draft).length > 0) return true;
  return normalizeEmail(draft.email).includes("@");
}
