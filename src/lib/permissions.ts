export function isSuperAdmin(profile: { is_superadmin?: boolean } | null | undefined): boolean {
  return profile?.is_superadmin === true;
}
