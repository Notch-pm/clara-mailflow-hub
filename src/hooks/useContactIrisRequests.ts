import { useQuery } from "@tanstack/react-query";
import { useOrganization } from "@/contexts/OrganizationContext";
import { listContactIrisRequests } from "@/services/irisContactRequestService";

/**
 * Demandes Iris d'un usager — partagé par la fiche contact et l'espace élu.
 * `data === null` : tenant non raccordé à Iris, la section ne s'affiche pas.
 */
export function useContactIrisRequests(socleContactId: string | null | undefined) {
  const { organizationId } = useOrganization();
  return useQuery({
    queryKey: ["contact-iris-requests", organizationId, socleContactId],
    queryFn: () => listContactIrisRequests(organizationId!, socleContactId!),
    enabled: !!organizationId && !!socleContactId,
    staleTime: 30_000,
    retry: 1,
  });
}
