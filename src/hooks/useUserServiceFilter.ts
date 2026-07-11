import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Returns the list of organization UUIDs (miroir Socle) the current user belongs to.
 * - null  → no restriction (admin / superadmin sees everything)
 * - string[] → user can only see couriers with socle_organization_id IN this list
 *   OR socle_organization_id IS NULL (courriers non assignés visibles par tous)
 */
export function useUserServiceFilter(): string[] | null {
  const { profile, membership, user } = useAuth();

  const isSuperAdmin = profile?.is_superadmin === true;
  const isOrgAdmin = membership?.role === "admin" || membership?.role === "administrateur";
  const shouldFilter = !isSuperAdmin && !isOrgAdmin;

  const { data: orgIds } = useQuery({
    queryKey: ["user-service-filter", user?.id, membership?.organization_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("socle_organization_members")
        .select("socle_organization_id")
        .eq("user_id", user!.id);
      if (error) throw error;
      return ((data ?? []) as { socle_organization_id: string }[])
        .map((r) => r.socle_organization_id)
        .filter(Boolean);
    },
    enabled: shouldFilter && !!user?.id,
    staleTime: 60_000,
  });

  if (!shouldFilter) return null;
  return orgIds ?? [];
}

/**
 * Applies the organization filter (UUIDs) to a list of couriers.
 * Couriers with no organization are always visible.
 */
export function applyServiceFilter<T extends { socle_organization_id?: string | null }>(
  couriers: T[],
  orgFilter: string[] | null,
): T[] {
  if (orgFilter === null) return couriers;
  return couriers.filter(
    (c) => !c.socle_organization_id || orgFilter.includes(c.socle_organization_id),
  );
}
