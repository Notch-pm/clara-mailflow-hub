/**
 * Rapprochement de l'expéditeur d'un courrier avec le référentiel Socle —
 * règle UNIQUE, partagée par `extract-courier-info` (Deno) et par l'import en
 * masse côté client (Vite). Logique pure, sans import : les deux mondes ne
 * résolvent pas les modules de la même façon.
 *
 * Le rapprochement lui-même appartient au Socle (`POST /v1/contacts/match`) ;
 * ce module ne fait que construire la question et trancher sur la réponse :
 *
 *  - email, téléphone ou nom+prénom identiques (motifs `email`, `phone`,
 *    `name_exact`) → le contact est **sélectionné** ;
 *  - … mais si la fiche porte un autre email / téléphone que le courrier, ou
 *    un autre nom (rapprochement au seul téléphone d'un foyer), la sélection
 *    s'accompagne d'une **alerte** (`conflicts`) ;
 *  - un nom seulement proche (`name_similar`) est **proposé**, jamais
 *    sélectionné d'office : c'est à l'agent de confirmer ;
 *  - sinon, aucun contact : l'appelant crée la fiche.
 *
 * Historique : l'ancien rapprochement cherchait le NOM DE FAMILLE seul
 * (`?search=Lefevre&limit=1`) et retenait le premier venu — Madeleine Lefevre
 * se voyait proposer Alain Lefevre.
 */

export type SenderCivility = "madame" | "monsieur";

/** Identité de l'expéditeur telle qu'extraite du courrier ou saisie. */
export interface SenderIdentity {
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
}

/** Sous-ensemble de la fiche Socle utile au rapprochement. */
export interface MatchableContact {
  id: string;
  first_name: string | null;
  last_name: string | null;
  usage_name?: string | null;
  display_name: string | null;
  email: string | null;
  mobile_phone: string | null;
  landline_phone: string | null;
}

/** Candidat renvoyé par `POST /v1/contacts/match`. */
export interface MatchCandidate<C extends MatchableContact = MatchableContact> {
  contact: C;
  reasons: string[];
  score: number;
}

export type SenderMatchStatus = "matched" | "suggested" | "none";
export type SenderMatchConflict = "email" | "phone" | "name";

export interface SenderMatch<C extends MatchableContact = MatchableContact> {
  status: SenderMatchStatus;
  /** Contact sélectionné (`matched`) ou proposé (`suggested`), `null` sinon. */
  contact: C | null;
  reasons: string[];
  /** Divergences entre le courrier et la fiche retenue — à signaler à l'agent. */
  conflicts: SenderMatchConflict[];
}

/** Aucun contact rapproché : l'appelant créera la fiche. */
export function noSenderMatch<C extends MatchableContact = MatchableContact>(): SenderMatch<C> {
  return { status: "none", contact: null, reasons: [], conflicts: [] };
}

/** Motifs qui suffisent à sélectionner un contact. */
const STRONG_REASONS = ["email", "phone", "name_exact"];

/** Bornes et seuils alignés sur `src/lib/contact-duplicates.ts`. */
const MIN_NAME_LENGTH = 2;
const MIN_PHONE_DIGITS = 6;
const MATCH_LIMIT = 5;

function trimmed(value: string | null | undefined): string {
  return (value ?? "").trim();
}

export function normalizeEmail(value: string | null | undefined): string {
  return trimmed(value).toLowerCase();
}

/** Téléphone réduit à ses chiffres, indicatif français ramené au 0 national. */
export function normalizePhone(value: string | null | undefined): string {
  let digits = (value ?? "").replace(/\D/g, "");
  if (digits.startsWith("0033")) digits = "0" + digits.slice(4);
  else if (digits.startsWith("33") && digits.length === 11) digits = "0" + digits.slice(2);
  return digits;
}

/** Nom normalisé pour comparaison : casse, accents et espaces ignorés. */
export function normalizeName(value: string | null | undefined): string {
  return trimmed(value)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")
    .trim();
}

/**
 * Payload de `POST /v1/contacts/match` pour un expéditeur (personne physique),
 * ou `null` s'il n'y a rien à rapprocher — un prénom seul ne rapproche rien,
 * le Socle répondrait 400.
 */
export function buildSenderMatchPayload(sender: SenderIdentity): Record<string, unknown> | null {
  const payload: Record<string, unknown> = { contact_type: "personne", limit: MATCH_LIMIT };
  let hasSignal = false;

  const first = trimmed(sender.first_name);
  if (first) payload.first_name = first;

  const last = trimmed(sender.last_name);
  if (last.length >= MIN_NAME_LENGTH) {
    payload.last_name = last;
    hasSignal = true;
  }

  const email = normalizeEmail(sender.email);
  if (email.includes("@")) {
    payload.email = email;
    hasSignal = true;
  }

  const phone = trimmed(sender.phone);
  if (phone.replace(/\D/g, "").length >= MIN_PHONE_DIGITS) {
    payload.phones = [phone];
    hasSignal = true;
  }

  return hasSignal ? payload : null;
}

/** Même personne au sens du nom : nom de naissance ou d'usage, et prénom s'il est connu des deux côtés. */
function sameName(sender: SenderIdentity, contact: MatchableContact): boolean {
  const last = normalizeName(sender.last_name);
  if (!last) return true; // rien à opposer
  const lastOk = [contact.last_name, contact.usage_name].some((n) => normalizeName(n) === last);
  if (!lastOk) return false;
  const first = normalizeName(sender.first_name);
  const cFirst = normalizeName(contact.first_name);
  return !first || !cFirst || first === cFirst;
}

function conflictsOf(sender: SenderIdentity, contact: MatchableContact, reasons: string[]): SenderMatchConflict[] {
  const out: SenderMatchConflict[] = [];

  const email = normalizeEmail(sender.email);
  const cEmail = normalizeEmail(contact.email);
  if (email && cEmail && email !== cEmail) out.push("email");

  const phone = normalizePhone(sender.phone);
  const cPhones = [contact.mobile_phone, contact.landline_phone].map(normalizePhone).filter(Boolean);
  if (phone.length >= MIN_PHONE_DIGITS && cPhones.length > 0 && !cPhones.includes(phone)) {
    out.push("phone");
  }

  // Retenu sur l'email ou le téléphone seul (foyer, standard partagé) alors
  // que le courrier nomme quelqu'un d'autre.
  if (!reasons.includes("name_exact") && !sameName(sender, contact)) out.push("name");

  return out;
}

/**
 * Tranche sur les candidats du Socle (déjà classés par score décroissant).
 * Le premier candidat porteur d'un motif fort est sélectionné ; à défaut, le
 * premier nom proche est proposé.
 */
export function resolveSenderMatch<C extends MatchableContact>(
  sender: SenderIdentity,
  candidates: MatchCandidate<C>[] | null | undefined,
): SenderMatch<C> {
  const list = Array.isArray(candidates) ? [...candidates].sort((a, b) => b.score - a.score) : [];

  const strong = list.find((c) => c.reasons.some((r) => STRONG_REASONS.includes(r)));
  if (strong) {
    return {
      status: "matched",
      contact: strong.contact,
      reasons: strong.reasons,
      conflicts: conflictsOf(sender, strong.contact, strong.reasons),
    };
  }

  const similar = list.find((c) => c.reasons.includes("name_similar"));
  if (similar) {
    return {
      status: "suggested",
      contact: similar.contact,
      reasons: similar.reasons,
      conflicts: conflictsOf(sender, similar.contact, similar.reasons),
    };
  }

  return noSenderMatch<C>();
}

/** Libellés des alertes, communs aux deux imports. */
export const SENDER_CONFLICT_LABELS: Record<SenderMatchConflict, string> = {
  email: "email différent de la fiche",
  phone: "téléphone différent de la fiche",
  name: "nom différent de la fiche",
};

/** Civilité extraite par l'IA, validée (`null` si absente ou hors domaine). */
export function cleanCivility(value: unknown): SenderCivility | null {
  const v = typeof value === "string" ? normalizeName(value) : "";
  if (v === "madame" || v === "mme" || v === "mademoiselle") return "madame";
  if (v === "monsieur" || v === "m" || v === "mr") return "monsieur";
  return null;
}

/**
 * Deux expéditeurs désignent-ils la même personne, selon la règle du
 * rapprochement (email, téléphone, ou nom+prénom) ? Sert à ne créer qu'UNE
 * fiche quand plusieurs courriers d'un même lot viennent de la même personne
 * encore inconnue du référentiel.
 */
export function isSameSender(a: SenderIdentity, b: SenderIdentity): boolean {
  const ea = normalizeEmail(a.email);
  if (ea.includes("@") && ea === normalizeEmail(b.email)) return true;
  const pa = normalizePhone(a.phone);
  if (pa.length >= MIN_PHONE_DIGITS && pa === normalizePhone(b.phone)) return true;
  const la = normalizeName(a.last_name);
  return (
    la.length >= MIN_NAME_LENGTH &&
    la === normalizeName(b.last_name) &&
    normalizeName(a.first_name) === normalizeName(b.first_name)
  );
}
