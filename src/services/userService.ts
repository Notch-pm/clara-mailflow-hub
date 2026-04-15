import { supabase } from "@/integrations/supabase/client";
import type { AppUser, AppUserInsert, OrganizationUserInsert, OrgMember } from "@/types/user";

/**
 * List users belonging to an organization (JOIN users + organization_users).
 */
export async function getOrgMembers(organizationId: string): Promise<OrgMember[]> {
  // Use organization_users as base, join users via user_id
  const { data, error } = await supabase
    .from("organization_users" as any)
    .select("id, role, is_active, user_id, users:user_id(id, email, first_name, last_name, is_active)")
    .eq("organization_id", organizationId);

  if (error) throw error;
  if (!data) return [];

  return (data as any[]).map((row) => ({
    id: row.users.id,
    email: row.users.email,
    first_name: row.users.first_name,
    last_name: row.users.last_name,
    is_active: row.users.is_active,
    role: row.role,
    membership_id: row.id,
    membership_active: row.is_active,
  }));
}

/**
 * Get a single user detail within an organization.
 */
export async function getOrgMember(organizationId: string, userId: string): Promise<OrgMember | null> {
  const { data, error } = await supabase
    .from("organization_users" as any)
    .select("id, role, is_active, user_id, users:user_id(id, email, first_name, last_name, is_active)")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const row = data as any;
  return {
    id: row.users.id,
    email: row.users.email,
    first_name: row.users.first_name,
    last_name: row.users.last_name,
    is_active: row.users.is_active,
    role: row.role,
    membership_id: row.id,
    membership_active: row.is_active,
  };
}

/**
 * Create a user + link to organization in one flow.
 * Returns the created user ID.
 */
export async function createOrgMember(
  organizationId: string,
  userData: { email: string; first_name: string; last_name: string },
  role: string
): Promise<string> {
  // 1. Check email uniqueness
  const { data: existing } = await supabase
    .from("users" as any)
    .select("id")
    .eq("email", userData.email)
    .maybeSingle();

  let userId: string;

  if (existing) {
    userId = (existing as any).id;
    // Check if already linked to this org
    const { data: existingLink } = await supabase
      .from("organization_users" as any)
      .select("id")
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .maybeSingle();

    if (existingLink) {
      throw new Error("Cet utilisateur est déjà membre de cette organisation.");
    }
  } else {
    // 2. Create user
    const { data: newUser, error: userError } = await supabase
      .from("users" as any)
      .insert({
        email: userData.email,
        first_name: userData.first_name,
        last_name: userData.last_name,
        password_hash: "pending_auth_setup",
      } satisfies AppUserInsert)
      .select("id")
      .single();

    if (userError) {
      if (userError.code === "23505") throw new Error("Un utilisateur avec cet email existe déjà.");
      throw userError;
    }
    userId = (newUser as any).id;
  }

  // 3. Create organization_users link
  const { error: linkError } = await supabase
    .from("organization_users" as any)
    .insert({
      organization_id: organizationId,
      user_id: userId,
      role,
      is_active: true,
    } satisfies OrganizationUserInsert);

  if (linkError) throw linkError;

  return userId;
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
  const promises: Promise<any>[] = [];

  // Update user fields
  const userUpdates: Record<string, any> = {};
  if (updates.first_name !== undefined) userUpdates.first_name = updates.first_name;
  if (updates.last_name !== undefined) userUpdates.last_name = updates.last_name;
  if (updates.is_active !== undefined) userUpdates.is_active = updates.is_active;

  if (Object.keys(userUpdates).length > 0) {
    promises.push(
      (async () => {
        const { error } = await supabase.from("users" as any).update(userUpdates).eq("id", userId);
        if (error) throw error;
      })()
    );
  }

  // Update role / membership active
  const membershipUpdates: Record<string, any> = {};
  if (updates.role !== undefined) membershipUpdates.role = updates.role;
  if (updates.is_active !== undefined) membershipUpdates.is_active = updates.is_active;

  if (Object.keys(membershipUpdates).length > 0) {
    promises.push(
      (async () => {
        const { error } = await supabase
          .from("organization_users" as any)
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
    supabase.from("users" as any).update({ is_active: false }).eq("id", userId),
    supabase
      .from("organization_users" as any)
      .update({ is_active: false })
      .eq("id", membershipId)
      .eq("organization_id", organizationId),
  ]);
}
