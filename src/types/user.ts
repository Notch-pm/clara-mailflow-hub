// Rôle d'organisation et vue « membre » (users + organization_users) des écrans
// d'administration. Les lignes brutes viennent du type généré `Database`.

export type OrgUserRole = "administrateur" | "gestionnaire" | "consultant" | "elu" | "superviseur";

/** Flattened user + org membership for list views */
export interface OrgMember {
  id: string; // users.id
  email: string;
  first_name: string | null;
  last_name: string | null;
  is_active: boolean | null;
  avatar_url: string | null;
  role: string;
  is_signataire: boolean;
  signataire_title: string | null;
  /** Profil « gestionnaire courrier » (écran Courrier entrant), indépendant du rôle. */
  is_service_courrier: boolean;
  /** Droit de viser une réponse (étape de visa), indépendant du rôle. */
  is_viseur: boolean;
  /** Lit les courriers confidentiels, indépendant du rôle. */
  can_read_confidential: boolean;
  membership_id: string; // organization_users.id
  membership_active: boolean;
}
