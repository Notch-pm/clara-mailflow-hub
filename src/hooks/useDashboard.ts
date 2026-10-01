import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/contexts/OrganizationContext";
import { useEluSignatureQueue } from "@/hooks/useEluSignatureQueue";
import { useEluVisaQueue } from "@/hooks/useEluVisaQueue";
import { canAccessParapheur, isOrgAdmin, isServiceCourrier } from "@/lib/permissions";
import { classifyCourier, type MailroomItem } from "@/lib/mailroom";
import {
  dashboardRoles,
  defaultListRole,
  heroAction,
  instructionList,
  instructionTodo,
  kpiSince,
  mailroomList,
  mailroomTodo,
  orgLateCount,
  parapheurList,
  parapheurTodo,
  sortTodo,
  type DashboardList,
  type ParapheurEntry,
} from "@/lib/dashboard";
import { fetchMailroomCouriers } from "@/services/mailroomService";
import { assignableOrgs, listOrgsWithConfig } from "@/services/socleOrgConfigService";
import { countMyDraftReplies, listMySocleOrganizationIds, listWorkflowStateNames } from "@/services/dashboardService";

const REFRESH_MS = 2 * 60_000;

/**
 * Données de la page d'accueil. Une seule lecture des courriers reçus (RPC
 * `mailroom_couriers`, ouverts + résolus depuis le début du mois d'avant le
 * dernier mois complet), classée comme dans « Courrier entrant » ; les files
 * du parapheur sous les clés de cache de l'espace élu et du rail.
 */
export function useDashboard() {
  const { user, membership } = useAuth();
  const { organizationId } = useOrganization();

  const since = useMemo(() => kpiSince(), []);

  const orgsQuery = useQuery({
    queryKey: ["socle-orgs-config", organizationId],
    queryFn: () => listOrgsWithConfig(organizationId!),
    enabled: !!organizationId,
  });

  const rowsQuery = useQuery({
    queryKey: ["dashboard-couriers", organizationId, since.toISOString()],
    queryFn: () => fetchMailroomCouriers(organizationId!, since),
    enabled: !!organizationId,
    refetchInterval: REFRESH_MS,
  });

  const myOrgsQuery = useQuery({
    queryKey: ["my-socle-organizations", user?.id, organizationId],
    queryFn: () => listMySocleOrganizationIds(user!.id),
    enabled: !!user?.id && !!organizationId,
    staleTime: 60_000,
  });

  const statesQuery = useQuery({
    queryKey: ["workflow-state-names", organizationId],
    queryFn: listWorkflowStateNames,
    enabled: !!organizationId,
  });

  const draftsQuery = useQuery({
    queryKey: ["dashboard-draft-replies", organizationId, user?.id],
    queryFn: () => countMyDraftReplies(organizationId!, user!.id),
    enabled: !!organizationId && !!user?.id,
  });

  const visa = useEluVisaQueue();
  const signature = useEluSignatureQueue();

  const orgs = orgsQuery.data;
  const items = useMemo<MailroomItem[]>(() => {
    if (!rowsQuery.data || !orgs) return [];
    const now = new Date(rowsQuery.dataUpdatedAt || Date.now());
    const assignableIds = new Set(assignableOrgs(orgs).map((o) => o.id));
    return rowsQuery.data.map((row) => classifyCourier(row, { assignableIds, orgs, now }));
  }, [rowsQuery.data, rowsQuery.dataUpdatedAt, orgs]);

  // Seules les organisations encore présentes dans le miroir comptent.
  const myOrgIds = useMemo(() => {
    const known = new Set((orgs ?? []).map((o) => o.id));
    return (myOrgsQuery.data ?? []).filter((id) => known.has(id));
  }, [myOrgsQuery.data, orgs]);

  const roles = useMemo(
    () =>
      dashboardRoles({
        memberOfServices: myOrgIds.length > 0,
        isServiceCourrier: isServiceCourrier(membership),
        canAccessParapheur: canAccessParapheur(membership),
      }),
    [myOrgIds.length, membership],
  );

  // Sans service de rattachement, la vue « instruction » couvre toute l'organisation.
  const myScope = useMemo(() => (myOrgIds.length ? new Set(myOrgIds) : null), [myOrgIds]);
  const serviceNames = useMemo(
    () => myOrgIds.map((id) => orgs?.find((o) => o.id === id)?.name).filter((n): n is string => !!n),
    [myOrgIds, orgs],
  );

  const parapheurEntries = useMemo<ParapheurEntry[]>(
    () => [
      // Comme le badge du rail : un visa désigné à un autre ne m'attend pas.
      ...visa.items
        .filter((i) => !i.designatedToOther)
        .map<ParapheurEntry>((i) => ({
          kind: "visa",
          replyId: i.replyId,
          parentCourierId: i.parentCourierId,
          title: i.title,
          chrono: i.chrono,
          senderName: i.senderName,
          step: i.stateName,
          waitingDays: i.waitingDays,
        })),
      ...signature.items.map<ParapheurEntry>((i) => ({
        kind: "signature",
        replyId: i.replyId,
        parentCourierId: i.parentCourierId,
        title: i.title,
        chrono: i.chrono,
        senderName: i.senderName,
        step: "À signer",
        waitingDays: i.waitingDays,
      })),
    ],
    [visa.items, signature.items],
  );

  const view = useMemo(() => {
    const stateName = (id: string | null) => (id ? (statesQuery.data?.get(id) ?? null) : null);
    const orgName = (id: string | null) => (id ? (orgs?.find((o) => o.id === id)?.name ?? null) : null);
    const has = (r: (typeof roles)[number]) => roles.includes(r);

    const instructionCards = has("instruction") ? instructionTodo(items, myScope, draftsQuery.data ?? 0) : [];
    const todo = sortTodo([
      ...instructionCards,
      ...(has("mailroom") ? mailroomTodo(items) : []),
      ...(has("parapheur")
        ? parapheurTodo(
            parapheurEntries,
            // Les retards de l'organisation : pour un viseur administrateur que
            // ni le service courrier ni un service ne les lui montre déjà.
            isOrgAdmin(membership) && !has("mailroom") && !has("instruction") ? orgLateCount(items) : null,
          )
        : []),
    ]);

    const lists: DashboardList[] = roles.map((role) =>
      role === "instruction"
        ? instructionList(items, myScope, stateName)
        : role === "mailroom"
          ? mailroomList(items, orgName)
          : parapheurList(parapheurEntries),
    );

    const instructionLate = instructionCards.find((c) => c.key === "instruction-late")?.count ?? 0;
    return {
      todo,
      lists,
      defaultList: defaultListRole(lists),
      hero: heroAction({ roles, instructionLate, mailroomItems: items }),
    };
  }, [roles, items, myScope, draftsQuery.data, parapheurEntries, membership, statesQuery.data, orgs]);

  return {
    ...view,
    roles,
    items,
    myScope,
    serviceNames,
    isLoading: rowsQuery.isLoading || orgsQuery.isLoading || myOrgsQuery.isLoading,
    parapheurLoading: visa.isLoading || signature.isLoading,
    error: rowsQuery.error ?? orgsQuery.error,
  };
}
