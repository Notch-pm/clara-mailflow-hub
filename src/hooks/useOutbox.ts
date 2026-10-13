import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { fetchOutboundCouriers, listMyApprovalOrgIds } from "@/services/outboxService";
import { listOrgsWithConfig } from "@/services/socleOrgConfigService";
import { classifyOutbound, type OutboxItem } from "@/lib/outbox";

/** Fenêtre des courriers ENVOYÉS montrés ; les courriers en cours le sont tous. */
export type OutboxPeriod = 30 | 90 | 365;

/** Rafraîchissement automatique : visas et signatures se font aussi ailleurs. */
const REFRESH_MS = 2 * 60_000;

/**
 * Données de l'écran « Courriers sortants » : lignes du RPC classées par
 * étape, et organisations. La clé commence par `couriers-outbound` : les
 * invalidations déjà posées sur ce préfixe (création, rédaction, envoi)
 * rafraîchissent l'écran sans rien ajouter.
 */
export function useOutbox(organizationId: string | null | undefined, period: OutboxPeriod) {
  const { user } = useAuth();
  const orgsQuery = useQuery({
    queryKey: ["socle-orgs-config", organizationId],
    queryFn: () => listOrgsWithConfig(organizationId!),
    enabled: !!organizationId,
  });

  const rowsQuery = useQuery({
    queryKey: ["couriers-outbound", "outbox", organizationId, period],
    queryFn: () => fetchOutboundCouriers(organizationId!, new Date(Date.now() - period * 86_400_000)),
    enabled: !!organizationId,
    refetchInterval: REFRESH_MS,
  });

  const approvalOrgsQuery = useQuery({
    queryKey: ["outbox-approval-orgs", organizationId, user?.id],
    queryFn: () => listMyApprovalOrgIds(organizationId!, user!.id),
    enabled: !!organizationId && !!user?.id,
    staleTime: 5 * 60_000,
  });

  const items = useMemo<OutboxItem[]>(() => {
    if (!rowsQuery.data) return [];
    const now = new Date(rowsQuery.dataUpdatedAt || Date.now());
    return rowsQuery.data.map((row) => classifyOutbound(row, now));
  }, [rowsQuery.data, rowsQuery.dataUpdatedAt]);

  return {
    items,
    orgs: orgsQuery.data ?? [],
    /** Organisations dont je vise ou signe les sortants, visibles même sans en être membre. */
    approvalOrgIds: approvalOrgsQuery.data ?? [],
    isLoading: rowsQuery.isLoading,
    isFetching: rowsQuery.isFetching,
    error: rowsQuery.error,
    updatedAt: rowsQuery.dataUpdatedAt,
    refetch: rowsQuery.refetch,
  };
}
