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
