export function isSuperAdmin(profile: { is_superadmin?: boolean } | null | undefined): boolean {
  return profile?.is_superadmin === true;
}

export const ORG_ROLES = [
  { value: "administrateur", label: "Administrateur" },
  { value: "gestionnaire", label: "Gestionnaire" },
  { value: "consultant", label: "Consultant" },
  { value: "elu", label: "Élu" },
  { value: "superviseur", label: "Superviseur" },
] as const;

export type OrgRoleValue = (typeof ORG_ROLES)[number]["value"];

export const ORG_ROLE_VALUES = ORG_ROLES.map((r) => r.value) as [OrgRoleValue, ...OrgRoleValue[]];

type Membership = { role?: string | null } | null | undefined;
type Profile = { is_superadmin?: boolean } | null | undefined;

export function isOrgAdmin(membership: Membership): boolean {
  const r = membership?.role;
  return r === "admin" || r === "administrateur";
}

/** Consultant : rôle lecteur seul (RLS serveur bloque déjà ses écritures). */
export function isReadOnlyRole(membership: Membership): boolean {
  return membership?.role === "consultant";
}

/**
 * Peut créer/modifier des courriers (notes, tags, réponses, transitions,
 * pièces jointes…). Seul point de vérité UI pour distinguer un éditeur d'un
 * consultant (lecteur seul).
 */
export function canEditCouriers(profile: Profile, membership: Membership): boolean {
  return isSuperAdmin(profile) || (!!membership && !isReadOnlyRole(membership));
}

/** Settings hub: admin d'org + superadmin uniquement. */
export function canAccessSettings(profile: Profile, membership: Membership): boolean {
  return isSuperAdmin(profile) || isOrgAdmin(membership);
}

/** Stats: tout le monde sauf gestionnaire. */
export function canAccessStats(profile: Profile, membership: Membership): boolean {
  if (isSuperAdmin(profile)) return true;
  return membership?.role !== "gestionnaire";
}

/**
 * Élu : rôle de dirigeant (maire, adjoint, vice-président). Il a les mêmes
 * droits d'écriture qu'un gestionnaire — c'est `canEditCouriers` qui en décide —
 * mais il reçoit un espace dédié sur téléphone (voir `src/lib/elu-mode.ts`).
 *
 * Égalité stricte : contrairement à `administrateur`, qui traîne un alias
 * historique `admin`, `elu` n'a jamais été écrit autrement.
 */
export function isElu(membership: Membership): boolean {
  return membership?.role === "elu";
}

/**
 * Gestionnaire courrier (service courrier) : qualifie, route et suit les
 * courriers reçus depuis l'écran « Courrier entrant ». Attribut transverse,
 * indépendant du rôle (comme `is_signataire`) ; il n'ouvre aucun droit
 * d'écriture — c'est `canEditCouriers` qui en décide.
 */
export function isServiceCourrier(membership: { is_service_courrier?: boolean | null } | null | undefined): boolean {
  return membership?.is_service_courrier === true;
}

/** Écran « Courrier entrant » : gestionnaire courrier, administrateur ou superadmin. */
export function canAccessMailroom(
  profile: Profile,
  membership: (Membership & { is_service_courrier?: boolean | null }) | null | undefined,
): boolean {
  return isSuperAdmin(profile) || isOrgAdmin(membership) || isServiceCourrier(membership);
}

/**
 * Boîte aux lettres dans la navigation : un gestionnaire courrier qui n'est pas
 * administrateur ne la voit plus — « Courrier entrant » la remplace pour lui.
 * Les services la gardent (leurs courriers routés, pas encore pris en charge).
 */
export function showsMailbox(
  profile: Profile,
  membership: (Membership & { is_service_courrier?: boolean | null }) | null | undefined,
): boolean {
  return !isServiceCourrier(membership) || isOrgAdmin(membership) || isSuperAdmin(profile);
}

/**
 * Parapheur : réservé à qui peut viser ou signer. Les deux attributs sont
 * indépendants du rôle ; l'écran ne promet rien de plus — le serveur décide
 * de chaque visa (rattachement à l'organisation gestionnaire) et chaque
 * signature (fiche de signataire désignée).
 */
export function canAccessParapheur(
  membership: { is_signataire?: boolean | null; is_viseur?: boolean | null } | null | undefined,
): boolean {
  return membership?.is_signataire === true || membership?.is_viseur === true;
}

/** Visibilité d'une entrée de navigation (rail et barre mobile). */
export function navItemVisible(
  url: string,
  profile: Profile,
  membership:
    | (Membership & { is_service_courrier?: boolean | null; is_signataire?: boolean | null; is_viseur?: boolean | null })
    | null
    | undefined,
): boolean {
  switch (url) {
    case "/parapheur":
      return canAccessParapheur(membership);
    case "/statistiques":
      return canAccessStats(profile, membership);
    case "/courrier-entrant":
    case "/corbeille":
      return canAccessMailroom(profile, membership);
    case "/boite-aux-lettres":
      return showsMailbox(profile, membership);
    default:
      return true;
  }
}
