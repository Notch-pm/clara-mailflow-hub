// Logique pure (testable en Vitest) d'un dépôt PUBLIC de courrier : ce que
// partagent le formulaire iframe (`portal-form`) et le courrier libre du site
// Nora (`nora-courrier`). Aucune dépendance Deno ni Supabase ici — les écritures
// vivent dans `portalIntake.ts`.
//
// Les deux portes acceptent EXACTEMENT les mêmes champs d'expéditeur, avec les
// mêmes messages d'erreur : un usager qui écrit depuis l'iframe ou depuis Nora
// doit voir la même règle.

export const PORTAL_MAX_FILES = 3;
export const PORTAL_MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 Mo
export const PORTAL_SUBJECT_MAX = 500;
export const PORTAL_BODY_MAX = 20_000;

export const SENDER_CATEGORIES = ["citoyen", "entreprise", "association"] as const;
export type SenderCategory = (typeof SENDER_CATEGORIES)[number];

/** Les champs texte d'un dépôt, tels que lus du multipart. */
export interface PortalSubmissionFields {
  subject: string | null;
  body: string | null;
  senderCategory: string | null;
  senderCivilite: string | null;
  senderFirstName: string | null;
  senderLastName: string | null;
  senderEmail: string | null;
  senderPhone: string | null;
}

export interface PortalFileInfo {
  name: string;
  size: number;
}

/** Lecture des champs communs d'un multipart (`FormData.get`). */
export function portalFieldsFromForm(get: (field: string) => unknown): PortalSubmissionFields {
  const str = (k: string) => {
    const v = get(k);
    return typeof v === "string" ? v : null;
  };
  return {
    subject: str("subject"),
    body: str("body"),
    senderCategory: str("sender_category"),
    senderCivilite: str("sender_civilite"),
    senderFirstName: str("sender_first_name"),
    senderLastName: str("sender_last_name"),
    senderEmail: str("sender_email"),
    senderPhone: str("sender_phone"),
  };
}

/**
 * Le motif du refus d'un dépôt, ou `null` s'il est recevable. Les messages sont
 * ceux que `portal-form` sert depuis l'origine : l'iframe les affiche tels quels.
 */
export function portalSubmissionError(
  f: PortalSubmissionFields,
  files: PortalFileInfo[],
  opts: { bodyMax?: number } = {},
): string | null {
  const category = f.senderCategory ?? "citoyen";
  if (!f.subject?.trim()) return "Sujet obligatoire";
  if (!f.body?.trim()) return "Message obligatoire";
  if (opts.bodyMax !== undefined && f.body.trim().length > opts.bodyMax) {
    return `Message trop long (${opts.bodyMax} caractères au plus)`;
  }
  if (!(SENDER_CATEGORIES as readonly string[]).includes(category)) return "Catégorie invalide";
  if (category === "citoyen" && !f.senderFirstName?.trim()) return "Prénom obligatoire";
  if (!f.senderLastName?.trim()) return "Nom obligatoire";
  if (!f.senderEmail?.trim() && !f.senderPhone?.trim()) return "Email ou téléphone obligatoire";
  if (files.length > PORTAL_MAX_FILES) return `Maximum ${PORTAL_MAX_FILES} fichiers autorisés`;
  for (const file of files) {
    if (file.size > PORTAL_MAX_FILE_SIZE) return `Le fichier "${file.name}" dépasse la limite de 5 Mo`;
  }
  return null;
}

/** La ligne `courier_participants` de l'expéditeur, brute (`socle_contact_id: null`). */
export function portalSenderParticipant(f: PortalSubmissionFields) {
  const category = (f.senderCategory ?? "citoyen") as SenderCategory;
  const isCitoyen = category === "citoyen";
  const firstName = isCitoyen ? (f.senderFirstName?.trim() || null) : null;
  const lastName = (f.senderLastName ?? "").trim();
  const civilite = isCitoyen ? f.senderCivilite?.trim() : "";
  return {
    role: "sender" as const,
    name: isCitoyen ? [firstName, lastName].filter(Boolean).join(" ") : lastName,
    first_name: firstName,
    last_name: lastName,
    email: f.senderEmail?.trim() || null,
    phone: f.senderPhone?.trim() || null,
    // L'association à une fiche du Socle est un geste d'agent, à la vérification.
    socle_contact_id: null,
    metadata: {
      category,
      ...(civilite ? { civilite } : {}),
    },
  };
}

/** Nom de fichier sûr pour une clé de stockage. */
export function safeStorageName(name: string): string {
  return name.replace(/[^\w.-]+/g, "_");
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

// ── Routage d'un organisme du Socle vers un tenant Clara ──────────────────────
//
// Un organisme du Socle peut être recopié dans PLUSIEURS tenants Clara : chaque
// tenant recopie le sous-arbre de son `organizations.socle_org_id` (son ancre),
// et rien n'interdit qu'une ancre soit l'ancêtre d'une autre (une collectivité
// et l'un de ses services, abonnés séparément). Le courrier va au tenant dont
// l'ancre est la PLUS PROCHE de l'organisme : c'est celui qui l'administre au
// plus près. À distance égale, on ne choisit pas au hasard — on refuse.

/**
 * Nombre de remontées de `startId` jusqu'à `anchorId` dans le miroir d'un tenant
 * (`parentOf` : socle_id → socle_parent_id). `null` si l'ancre n'est pas un
 * ancêtre (miroir incohérent) — on ne route pas sur un miroir qu'on ne comprend pas.
 */
export function distanceToAnchor(
  startId: string,
  anchorId: string,
  parentOf: Map<string, string | null>,
): number | null {
  let current: string | null | undefined = startId;
  for (let hops = 0; hops <= 64 && current; hops++) {
    if (current === anchorId) return hops;
    current = parentOf.get(current);
  }
  return null;
}

export type TenantPick =
  | { kind: "none" }
  | { kind: "one"; organizationId: string }
  | { kind: "ambiguous"; organizationIds: string[] };

/** Choisit le tenant le plus proche ; `distance: null` = candidat écarté. */
export function pickTenant(candidates: { organizationId: string; distance: number | null }[]): TenantPick {
  const valid = candidates.filter((c): c is { organizationId: string; distance: number } => c.distance !== null);
  if (valid.length === 0) return { kind: "none" };
  const best = Math.min(...valid.map((c) => c.distance));
  const closest = valid.filter((c) => c.distance === best);
  if (closest.length === 1) return { kind: "one", organizationId: closest[0].organizationId };
  return { kind: "ambiguous", organizationIds: closest.map((c) => c.organizationId) };
}
