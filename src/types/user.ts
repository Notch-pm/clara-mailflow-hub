// Manual types for users/organization_users/roles tables
// (not in auto-generated types.ts since tables were added outside Lovable)

export interface AppUser {
  id: string;
  email: string;
  password_hash: string | null;
  first_name: string | null;
  last_name: string | null;
  is_active: boolean | null;
  created_at: string;
  updated_at: string;
}

export interface AppUserInsert {
  id?: string;
  email: string;
  password_hash?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  is_active?: boolean | null;
}

export type OrgUserRole = "administrateur" | "gestionnaire" | "consultant";

export interface OrganizationUser {
  id: string;
  organization_id: string;
  user_id: string;
  role: string;
  is_active: boolean | null;
  is_signataire: boolean;
  signataire_title: string | null;
  created_at: string;
}

export interface OrganizationUserInsert {
  id?: string;
  organization_id: string;
  user_id: string;
  role: string;
  is_active?: boolean | null;
  is_signataire?: boolean;
  signataire_title?: string | null;
}

export interface OrgRole {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
}

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
  membership_id: string; // organization_users.id
  membership_active: boolean | null;
}
