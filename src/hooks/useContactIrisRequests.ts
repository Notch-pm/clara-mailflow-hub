import { useQuery } from "@tanstack/react-query";
import { useOrganization } from "@/contexts/OrganizationContext";
import { getIrisRequestDetail, listContactIrisRequests } from "@/services/irisContactRequestService";

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

/** Fil d'une demande Iris — page de détail du poste de travail et de l'espace élu. */
export function useIrisRequestDetail(irisRequestId: string | null | undefined) {
  const { organizationId } = useOrganization();
  return useQuery({
    queryKey: ["iris-request-detail", organizationId, irisRequestId],
    queryFn: () => getIrisRequestDetail(organizationId!, irisRequestId!),
    enabled: !!organizationId && !!irisRequestId,
    // Les commentaires internes ne restent pas en cache une fois la page quittée.
    gcTime: 0,
    retry: (count, error) => (error as { status?: number }).status !== 404 && count < 1,
  });
}
