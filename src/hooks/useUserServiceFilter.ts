import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Returns the list of service names the current user is allowed to see.
 * - null  → no restriction (admin / superadmin sees everything)
 * - string[] → user can only see couriers with assigned_service IN this list OR assigned_service IS NULL
 */
export function useUserServiceFilter(): string[] | null {
  const { profile, membership, user } = useAuth();

  const isSuperAdmin = profile?.is_superadmin === true;
  const isOrgAdmin = membership?.role === "admin" || membership?.role === "administrateur";
  const shouldFilter = !isSuperAdmin && !isOrgAdmin;

  const { data: serviceNames } = useQuery({
    queryKey: ["user-service-filter", user?.id, membership?.organization_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("service_members" as never)
        .select("services:service_id(name)")
        .eq("user_id", user!.id);
      if (error) throw error;
      return ((data ?? []) as { services: { name: string } | null }[])
        .map((r) => r.services?.name)
        .filter((n): n is string => !!n);
    },
    enabled: shouldFilter && !!user?.id,
    staleTime: 60_000,
  });

  if (!shouldFilter) return null;
  return serviceNames ?? [];
}

/**
 * Applies the service filter to a list of couriers.
 * Couriers with no assigned_service are always visible.
 */
export function applyServiceFilter<T extends { assigned_service?: string | null }>(
  couriers: T[],
  serviceFilter: string[] | null,
): T[] {
  if (serviceFilter === null) return couriers;
  return couriers.filter(
    (c) => !c.assigned_service || serviceFilter.includes(c.assigned_service),
  );
}
