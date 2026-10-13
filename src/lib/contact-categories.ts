/**
 * Catégories de contacts « Interne » et « Élus ».
 *
 * Ce ne sont pas des types de contact (une personne reste `personne`) mais des
 * RÔLES du référentiel, reconnus par leur `code` stable (contacts-api ≥ 1.3.0) :
 * `interne` (agents et services de la collectivité) et `elu`. Le nom d'un rôle se
 * renomme ; on ne s'y fie qu'en repli, tant qu'un référentiel plus ancien ne
 * sert pas le code.
 *
 * Usages : destinataire d'un courrier reçu, destinataire d'une tâche, expéditeur
 * facultatif d'un courrier sortant.
 */

export type ContactCategory = "interne" | "elu";

export const CONTACT_CATEGORIES: readonly ContactCategory[] = ["interne", "elu"];

/** Libellé d'un contact de la catégorie (badge). */
export const CONTACT_CATEGORY_LABELS: Record<ContactCategory, string> = {
  interne: "Interne",
  elu: "Élu",
};

/** Libellé de la catégorie au pluriel (filtres). */
export const CONTACT_CATEGORY_PLURAL_LABELS: Record<ContactCategory, string> = {
  interne: "Internes",
  elu: "Élus",
};

interface RoleLike {
  name: string;
  code?: string | null;
}

function normalize(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
}

/** Catégorie portée par un rôle : par code, sinon par nom exact (repli). */
export function roleCategory(role: RoleLike): ContactCategory | null {
  const code = role.code ?? null;
  if (code) return (CONTACT_CATEGORIES as readonly string[]).includes(code) ? (code as ContactCategory) : null;
  const n = normalize(role.name ?? "");
  return (CONTACT_CATEGORIES as readonly string[]).includes(n) ? (n as ContactCategory) : null;
}

/** Catégories d'un contact, dans l'ordre canonique (Interne puis Élu), sans doublon. */
export function contactCategories(contact: { roles?: RoleLike[] | null } | null | undefined): ContactCategory[] {
  const found = new Set<ContactCategory>();
  for (const r of contact?.roles ?? []) {
    const c = roleCategory(r);
    if (c) found.add(c);
  }
  return CONTACT_CATEGORIES.filter((c) => found.has(c));
}

/** Vrai si le contact porte au moins une des catégories demandées (liste vide = tout passe). */
export function matchesCategories(
  contact: { roles?: RoleLike[] | null } | null | undefined,
  categories: readonly ContactCategory[] | undefined,
): boolean {
  if (!categories || categories.length === 0) return true;
  const mine = contactCategories(contact);
  return categories.some((c) => mine.includes(c));
}

/**
 * Identifiant du rôle de chaque catégorie dans un catalogue (`GET /v1/contact-roles`).
 * Catégorie absente du catalogue = clé absente : Clara ne crée pas de rôle.
 */
export function categoryRoleIds(
  catalog: readonly (RoleLike & { id: string })[],
): Partial<Record<ContactCategory, string>> {
  const out: Partial<Record<ContactCategory, string>> = {};
  // Le code prime : un premier passage par code, puis le repli par nom.
  for (const r of catalog) {
    if (r.code && (CONTACT_CATEGORIES as readonly string[]).includes(r.code)) {
      out[r.code as ContactCategory] = r.id;
    }
  }
  for (const r of catalog) {
    const c = roleCategory(r);
    if (c && !out[c]) out[c] = r.id;
  }
  return out;
}

/** Valeur du paramètre `role` de la liste (`elu,interne`), `undefined` si vide. */
export function roleFilterParam(categories: readonly ContactCategory[] | undefined): string | undefined {
  if (!categories || categories.length === 0) return undefined;
  return [...new Set(categories)].join(",");
}
