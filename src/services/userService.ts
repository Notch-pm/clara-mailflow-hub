import { supabase } from "@/integrations/supabase/client";
import type { OrgMember } from "@/types/user";

interface OrgMemberRow {
  id: string;
  role: string;
  is_active: boolean | null;
  user_id: string;
  users: {
    id: string;
    email: string;
    first_name: string | null;
    last_name: string | null;
    is_active: boolean | null;
    avatar_url: string | null;
  };
}

function rowToMember(row: OrgMemberRow): OrgMember {
  return {
    id: row.users.id,
    email: row.users.email,
    first_name: row.users.first_name,
    last_name: row.users.last_name,
    is_active: row.users.is_active,
    avatar_url: row.users.avatar_url ?? null,
    role: row.role,
    membership_id: row.id,
    membership_active: row.is_active,
  };
}

/**
 * List users belonging to an organization (JOIN users + organization_users).
 */
export async function getOrgMembers(organizationId: string): Promise<OrgMember[]> {
  const { data, error } = await supabase
    .from("organization_users")
    .select("id, role, is_active, user_id, users:user_id(id, email, first_name, last_name, is_active, avatar_url)")
    .eq("organization_id", organizationId);

  if (error) throw error;
  if (!data) return [];

  return (data as unknown as OrgMemberRow[]).map(rowToMember);
}

/**
 * Get a single user detail within an organization.
 */
export async function getOrgMember(organizationId: string, userId: string): Promise<OrgMember | null> {
  const { data, error } = await supabase
    .from("organization_users")
    .select("id, role, is_active, user_id, users:user_id(id, email, first_name, last_name, is_active, avatar_url)")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return rowToMember(data as unknown as OrgMemberRow);
}

/**
 * Create a user via the invite-user Edge Function.
 * This creates an auth account, sends an invitation email,
 * creates the public.users record, and links to the organization.
 */
export async function createOrgMember(
  organizationId: string,
  userData: { email: string; first_name: string; last_name: string },
  role: string
): Promise<string> {
  const { data, error } = await supabase.functions.invoke("invite-user", {
    body: {
      email: userData.email,
      first_name: userData.first_name,
      last_name: userData.last_name,
      role,
      organization_id: organizationId,
    },
  });

  if (error) {
    throw new Error(error.message || "Erreur lors de l'invitation");
  }

  if (data?.error) {
    throw new Error(data.error);
  }

  return data.user_id;
}

/**
 * Update user info + role in organization.
 */
export async function updateOrgMember(
  organizationId: string,
  userId: string,
  membershipId: string,
  updates: { first_name?: string; last_name?: string; role?: string; is_active?: boolean }
) {
  const promises: Promise<void>[] = [];

  const userUpdates: { first_name?: string; last_name?: string; is_active?: boolean } = {};
  if (updates.first_name !== undefined) userUpdates.first_name = updates.first_name;
  if (updates.last_name !== undefined) userUpdates.last_name = updates.last_name;
  if (updates.is_active !== undefined) userUpdates.is_active = updates.is_active;

  if (Object.keys(userUpdates).length > 0) {
    promises.push(
      (async () => {
        const { error } = await supabase.from("users").update(userUpdates).eq("id", userId);
        if (error) throw error;
      })()
    );
  }

  const membershipUpdates: { role?: string; is_active?: boolean } = {};
  if (updates.role !== undefined) membershipUpdates.role = updates.role;
  if (updates.is_active !== undefined) membershipUpdates.is_active = updates.is_active;

  if (Object.keys(membershipUpdates).length > 0) {
    promises.push(
      (async () => {
        const { error } = await supabase
          .from("organization_users")
          .update(membershipUpdates)
          .eq("id", membershipId)
          .eq("organization_id", organizationId);
        if (error) throw error;
      })()
    );
  }

  await Promise.all(promises);
}

/**
 * Soft-delete: deactivate user + membership.
 */
export async function deactivateOrgMember(
  organizationId: string,
  userId: string,
  membershipId: string
) {
  await Promise.all([
    supabase.from("users").update({ is_active: false }).eq("id", userId),
    supabase
      .from("organization_users")
      .update({ is_active: false })
      .eq("id", membershipId)
      .eq("organization_id", organizationId),
  ]);
}

/**
 * Reactivate a previously deactivated user + membership.
 */
export async function reactivateOrgMember(
  organizationId: string,
  userId: string,
  membershipId: string
) {
  await Promise.all([
    supabase.from("users").update({ is_active: true }).eq("id", userId),
    supabase
      .from("organization_users")
      .update({ is_active: true })
      .eq("id", membershipId)
      .eq("organization_id", organizationId),
  ]);
}

/**
 * Send a password reset email via the org's SMTP.
 */
export async function sendPasswordReset(userId: string) {
  const { data, error } = await supabase.functions.invoke("send-password-reset", {
    body: { user_id: userId },
  });

  if (error) {
    throw new Error(error.message || "Erreur lors de l'envoi");
  }
  if (data?.error) {
    throw new Error(data.error);
  }
}
