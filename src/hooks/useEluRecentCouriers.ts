import { useQuery } from "@tanstack/react-query";
import { useOrganization } from "@/contexts/OrganizationContext";
import { useUserServiceFilter } from "@/hooks/useUserServiceFilter";
import { fetchCourierListPage } from "@/services/courierListService";

const PAGE_SIZE = 8;

/**
 * Les derniers courriers reçus, à montrer AVANT toute saisie.
 *
 * Un écran de recherche vide n'apprend rien : l'élu ouvre le plus souvent
 * l'application pour voir ce qui vient d'arriver, pas pour chercher une
 * référence qu'il connaîtrait déjà.
 *
 * Le périmètre RBAC (`visibleSocleOrganizationIds`) est appliqué en SQL par le
 * RPC, comme pour les listes de l'application complète.
 */
export function useEluRecentCouriers(enabled = true) {
  const { organizationId } = useOrganization();
  const visibleSocleOrganizationIds = useUserServiceFilter();

  const { data, isLoading } = useQuery({
    queryKey: ["elu-recent-couriers", organizationId, visibleSocleOrganizationIds],
    queryFn: async () => {
      const page = await fetchCourierListPage(
        {
          organizationId: organizationId!,
          direction: "inbound",
          visibleSocleOrganizationIds,
          sortBy: "received_at",
          sortDir: "desc",
        },
        0,
        PAGE_SIZE,
      );
      return page.rows;
    },
    enabled: enabled && !!organizationId,
    staleTime: 60_000,
  });

  return { couriers: data ?? [], isLoading };
}
