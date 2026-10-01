import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchMailroomCouriers } from "@/services/mailroomService";
import { assignableOrgs, listOrgsWithConfig } from "@/services/socleOrgConfigService";
import { classifyCourier, type MailroomItem } from "@/lib/mailroom";

/** Fenêtre des courriers TRAITÉS montrés ; les courriers ouverts le sont tous. */
export type MailroomPeriod = 7 | 30 | 90;

/** Rafraîchissement automatique : l'IMAP et la numérisation arrivent seuls. */
const REFRESH_MS = 2 * 60_000;

/**
 * Données de l'écran « Courrier entrant » : lignes du RPC classées en étapes,
 * et organisations (même clé que les listes et le délai, `socle-orgs-config`).
 */
export function useMailroom(organizationId: string | null | undefined, period: MailroomPeriod) {
  const orgsQuery = useQuery({
    queryKey: ["socle-orgs-config", organizationId],
    queryFn: () => listOrgsWithConfig(organizationId!),
    enabled: !!organizationId,
  });

  const rowsQuery = useQuery({
    queryKey: ["mailroom-couriers", organizationId, period],
    queryFn: () => fetchMailroomCouriers(organizationId!, new Date(Date.now() - period * 86_400_000)),
    enabled: !!organizationId,
    refetchInterval: REFRESH_MS,
  });

  const orgs = orgsQuery.data;
  const assignable = useMemo(() => (orgs ? assignableOrgs(orgs) : []), [orgs]);

  const items = useMemo<MailroomItem[]>(() => {
    if (!rowsQuery.data || !orgs) return [];
    // Échéances vues de l'instant du chargement : recalculées à chaque rafraîchissement.
    const now = new Date(rowsQuery.dataUpdatedAt || Date.now());
    const ctx = { assignableIds: new Set(assignable.map((o) => o.id)), orgs, now };
    return rowsQuery.data.map((row) => classifyCourier(row, ctx));
  }, [rowsQuery.data, rowsQuery.dataUpdatedAt, orgs, assignable]);

  return {
    items,
    orgs: orgs ?? [],
    assignable,
    isLoading: rowsQuery.isLoading || orgsQuery.isLoading,
    isFetching: rowsQuery.isFetching,
    error: rowsQuery.error ?? orgsQuery.error,
    updatedAt: rowsQuery.dataUpdatedAt,
    refetch: rowsQuery.refetch,
  };
}
