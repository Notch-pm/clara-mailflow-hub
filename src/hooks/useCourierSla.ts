import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { listOrgsWithConfig } from "@/services/socleOrgConfigService";
import { courierSla, resolveSlaTargets, type CourierSla, type CourierSlaInput } from "@/lib/courier-sla";

/**
 * Échéances d'un courrier reçu, à partir des objectifs de son organisation.
 *
 * Partage la requête `["socle-orgs-config", orgId]` des pages de liste (même
 * clé, même fonction) : aucun aller-retour de plus là où les organisations
 * sont déjà chargées pour les filtres.
 */
export function useCourierSla(organizationId: string | null | undefined) {
  const { data: orgs } = useQuery({
    queryKey: ["socle-orgs-config", organizationId],
    queryFn: () => listOrgsWithConfig(organizationId!),
    enabled: !!organizationId,
  });

  return useCallback(
    (courier: CourierSlaInput & { socle_organization_id: string | null }): CourierSla | null => {
      if (!orgs) return null;
      return courierSla(courier, resolveSlaTargets(orgs, courier.socle_organization_id));
    },
    [orgs],
  );
}
