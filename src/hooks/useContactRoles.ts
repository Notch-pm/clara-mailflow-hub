import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listContactRoles, type SocleContact } from "@/services/socleContactService";
import { rolesToSend, sortRoleOptions, toggleRoleId } from "@/lib/contact-form";

/** Catalogue des rôles du référentiel (partagé par le formulaire et les relations). */
export function useContactRoleCatalog(organizationId: string, enabled = true) {
  return useQuery({
    queryKey: ["socle-contact-roles", organizationId],
    queryFn: () => listContactRoles(organizationId),
    enabled: enabled && !!organizationId,
    staleTime: 5 * 60_000,
  });
}

/**
 * Sélection des rôles dans le formulaire contact : hors du schéma zod, car le
 * référentiel REMPLACE l'ensemble. `null` = l'agent n'y a pas touché.
 */
export function useContactRoleSelection(organizationId: string, contact: SocleContact | null, open: boolean) {
  const rolesQuery = useContactRoleCatalog(organizationId, open);
  const initialRoleIds = useMemo(() => (contact?.roles ?? []).map((r) => r.id), [contact]);
  const [roleIds, setRoleIds] = useState<string[] | null>(null);
  const roleOptions = useMemo(() => sortRoleOptions(rolesQuery.data ?? []), [rolesQuery.data]);

  return {
    rolesQuery,
    roleOptions,
    currentRoleIds: roleIds ?? initialRoleIds,
    toggleRole: (id: string, checked: boolean) =>
      setRoleIds((cur) => toggleRoleId(cur ?? initialRoleIds, id, checked)),
    reset: () => setRoleIds(null),
    /** `null` : ne pas envoyer `role_ids`. */
    roleIdsToSend: () => rolesToSend(roleIds, initialRoleIds, rolesQuery.isSuccess),
  };
}
