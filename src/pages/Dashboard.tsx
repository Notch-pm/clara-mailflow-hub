import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { MailOpen, Clock, FileText, FileCheck, PenLine } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";
import { useAuth } from "@/contexts/AuthContext";
import { useUserServiceFilter, applyServiceFilter } from "@/hooks/useUserServiceFilter";

// ─── KPI card ────────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  sub,
  Icon,
  iconColor,
  href,
  loading,
}: {
  label: string;
  value: number;
  sub?: string;
  Icon: React.ElementType;
  iconColor: string;
  href?: string;
  loading: boolean;
}) {
  const inner = (
    // `flex flex-col` + `mt-auto` sur le contenu : deux cartes voisines dont le
    // libellé tient sur un nombre de lignes différent gardent malgré tout leurs
    // valeurs sur la même ligne de fond.
    <Card
      className={`flex h-full flex-col ${href ? "hover:shadow-airbnb transition-shadow cursor-pointer" : ""}`}
    >
      {/* `space-y-0` neutralise l'espacement vertical de `CardHeader`, qui
          décalerait l'icône vers le bas une fois la rangée passée en `flex-row`. */}
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 p-4 pb-2 md:p-6 md:pb-2">
        <CardTitle className="min-w-0 text-[13px] font-medium leading-snug text-muted-foreground md:text-sm">
          {label}
        </CardTitle>
        <Icon className={`h-4 w-4 shrink-0 md:h-5 md:w-5 ${iconColor}`} />
      </CardHeader>
      <CardContent className="mt-auto p-4 pt-0 md:p-6 md:pt-0">
        {loading ? (
          <Skeleton className="h-8 w-14 md:h-9 md:w-16" />
        ) : (
          <div className="text-2xl font-bold md:text-3xl">{value}</div>
        )}
        {sub && <p className="mt-1 truncate text-xs capitalize text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
  return href ? <Link to={href} className="block h-full">{inner}</Link> : inner;
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { organizationId } = useOrganization();
  const { user } = useAuth();
  const serviceFilter = useUserServiceFilter();

  const now = new Date();
  const startOfCurrentMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const startOfPrevMonth    = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
  const startOfNextMonth    = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();
  const currentMonthLabel   = now.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  const prevMonthLabel      = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    .toLocaleDateString("fr-FR", { month: "long", year: "numeric" });

  // ── Inbound couriers (lightweight) ────────────────────────────────────────
  // PostgREST plafonne toute requête sans .range() au "Max Rows" du projet
  // (1000 par défaut) : au-delà, la page se pagine explicitement pour ne pas
  // tronquer silencieusement les KPI sur les organisations à fort volume.
  const { data: rawInbound, isLoading: loadingCouriers } = useQuery({
    queryKey: ["dashboard-inbound", organizationId],
    queryFn: async () => {
      const fetchPage = (from: number, to: number) =>
        supabase
          .from("couriers")
          .select("id, subject, received_at, created_at, updated_at, workflow_state_id, assigned_service, socle_organization_id")
          .eq("organization_id", organizationId!)
          .eq("direction", "inbound")
          .order("id")
          .range(from, to);

      const pageSize = 1000;
      const rows: NonNullable<Awaited<ReturnType<typeof fetchPage>>["data"]> = [];
      let offset = 0;
      let hasMore = true;
      while (hasMore) {
        const { data, error } = await fetchPage(offset, offset + pageSize - 1);
        if (error) throw error;
        rows.push(...(data ?? []));
        hasMore = (data?.length ?? 0) === pageSize;
        offset += pageSize;
      }
      return rows;
    },
    enabled: !!organizationId,
  });

  // ── Workflow states (RLS-scoped to org via x-org-id header) ───────────────
  const { data: workflowStates, isLoading: loadingStates } = useQuery({
    queryKey: ["dashboard-workflow-states", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("workflow_states")
        .select("id, category, is_initial");
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!organizationId,
  });

  // ── Current user's signatory ───────────────────────────────────────────────
  const { data: userSignatory } = useQuery({
    queryKey: ["dashboard-signatory", user?.id, organizationId],
    queryFn: async () => {
      const { data } = await supabase
        .from("signatories")
        .select("id, first_name, last_name")
        .eq("organization_id", organizationId!)
        .eq("user_id", user!.id)
        .maybeSingle();
      return data ?? null;
    },
    enabled: !!user?.id && !!organizationId,
  });

  // ── Outbound couriers awaiting signature (only if user is a signatory) ────
  const { data: pendingSignature } = useQuery({
    queryKey: ["dashboard-pending-signature", userSignatory?.id, organizationId],
    queryFn: async () => {
      // 1. Workflow states named "signature" (reply workflows)
      const { data: sigStates } = await supabase
        .from("workflow_states")
        .select("id")
        .ilike("name", "%signature%");
      const sigStateIds = (sigStates ?? []).map((s) => s.id);
      if (!sigStateIds.length) return [];

      // 2. Outbound couriers in those states
      const { data, error } = await supabase
        .from("couriers")
        .select("id, subject, created_at, metadata, parent_courier_id")
        .eq("organization_id", organizationId!)
        .eq("direction", "outbound")
        .in("workflow_state_id", sigStateIds);
      if (error) throw error;

      // 3. Filter by signataire
      return (data ?? []).filter((c) => {
        const meta = (c.metadata ?? {}) as Record<string, unknown>;
        return meta.signatory_id === userSignatory!.id;
      });
    },
    enabled: !!userSignatory?.id && !!organizationId,
  });

  // ── Derived state ID sets ──────────────────────────────────────────────────
  const initialStateIds   = useMemo(() => (workflowStates ?? []).filter((s) => s.is_initial).map((s) => s.id), [workflowStates]);
  const processingStateIds = useMemo(() => (workflowStates ?? []).filter((s) => s.category === "processing").map((s) => s.id), [workflowStates]);
  const processedStateIds  = useMemo(() => (workflowStates ?? []).filter((s) => s.category === "processed").map((s) => s.id), [workflowStates]);

  // ── Apply service filter ───────────────────────────────────────────────────
  const couriers = useMemo(
    () => applyServiceFilter(rawInbound ?? [], serviceFilter),
    [rawInbound, serviceFilter],
  );

  // ── KPIs ──────────────────────────────────────────────────────────────────
  const loading = loadingCouriers || loadingStates;

  const recusMoisEnCours = useMemo(() =>
    couriers.filter((c) => {
      const d = c.received_at ?? c.created_at;
      return d >= startOfCurrentMonth && d < startOfNextMonth;
    }).length,
  [couriers, startOfCurrentMonth, startOfNextMonth]);

  const recusMoisPrecedent = useMemo(() =>
    couriers.filter((c) => {
      const d = c.received_at ?? c.created_at;
      return d >= startOfPrevMonth && d < startOfCurrentMonth;
    }).length,
  [couriers, startOfPrevMonth, startOfCurrentMonth]);

  const courriersEnAttente = useMemo(() =>
    couriers
      .filter((c) => !c.workflow_state_id || initialStateIds.includes(c.workflow_state_id))
      .sort((a, b) => {
        const da = a.received_at ?? a.created_at;
        const db = b.received_at ?? b.created_at;
        return new Date(db).getTime() - new Date(da).getTime();
      }),
  [couriers, initialStateIds]);

  const enAttente = courriersEnAttente.length;

  const enInstruction = useMemo(() =>
    couriers.filter((c) => c.workflow_state_id && processingStateIds.includes(c.workflow_state_id)).length,
  [couriers, processingStateIds]);

  const traitesMoisEnCours = useMemo(() =>
    couriers.filter((c) => {
      if (!c.workflow_state_id || !processedStateIds.includes(c.workflow_state_id)) return false;
      const d = c.updated_at ?? c.created_at;
      return d >= startOfCurrentMonth && d < startOfNextMonth;
    }).length,
  [couriers, processedStateIds, startOfCurrentMonth, startOfNextMonth]);

  const traitesMoisPrecedent = useMemo(() =>
    couriers.filter((c) => {
      if (!c.workflow_state_id || !processedStateIds.includes(c.workflow_state_id)) return false;
      const d = c.updated_at ?? c.created_at;
      return d >= startOfPrevMonth && d < startOfCurrentMonth;
    }).length,
  [couriers, processedStateIds, startOfPrevMonth, startOfCurrentMonth]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 md:space-y-8">
      {/* La recherche globale a quitté cet en-tête pour celui de l'application,
          où elle reste accessible depuis tous les écrans. */}
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight">Tableau de bord</h1>
        <p className="text-muted-foreground">Vue d'ensemble de votre gestion du courrier</p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4">
        <KpiCard label="Courriers reçus"          value={recusMoisEnCours}    sub={currentMonthLabel} Icon={MailOpen}   iconColor="text-primary"         href="/boite-aux-lettres"        loading={loading} />
        <KpiCard label="Courriers reçus (M−1)"    value={recusMoisPrecedent}  sub={prevMonthLabel}    Icon={MailOpen}   iconColor="text-muted-foreground"                                  loading={loading} />
        <KpiCard label="En attente d'instruction" value={enAttente}                                   Icon={Clock}      iconColor="text-warning"          href="/boite-aux-lettres"        loading={loading} />
        <KpiCard label="En instruction"           value={enInstruction}                               Icon={FileText}   iconColor="text-blue-500"         href="/courriers-en-instruction" loading={loading} />
        <KpiCard label="Courriers traités"        value={traitesMoisEnCours}  sub={currentMonthLabel} Icon={FileCheck}  iconColor="text-secondary"        href="/courriers-traites"        loading={loading} />
        <KpiCard label="Courriers traités (M−1)"  value={traitesMoisPrecedent} sub={prevMonthLabel}   Icon={FileCheck}  iconColor="text-muted-foreground"                                  loading={loading} />
      </div>

      {/* Listes côte à côte — chacune prend toute la largeur si l'autre est absente */}
      {(courriersEnAttente.length > 0 || (userSignatory && (pendingSignature?.length ?? 0) > 0)) && (
        <div className={`grid grid-cols-1 items-start gap-4 md:gap-6 ${courriersEnAttente.length > 0 && userSignatory && (pendingSignature?.length ?? 0) > 0 ? "lg:grid-cols-2" : ""}`}>

          {/* En attente de prise en charge */}
          {courriersEnAttente.length > 0 && (
            <section className="space-y-3">
              {/* `flex-wrap` + `min-w-0` : sur un téléphone, « Voir tous »
                  descend d'une ligne au lieu d'élargir la page. */}
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <div className="flex min-w-0 items-center gap-2">
                  <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <h2 className="min-w-0 text-base font-semibold">En attente de prise en charge</h2>
                  <Badge variant="secondary" className="shrink-0">{courriersEnAttente.length}</Badge>
                </div>
                {courriersEnAttente.length > 20 && (
                  <Link to="/boite-aux-lettres" className="ml-auto shrink-0 text-xs text-muted-foreground transition-colors hover:text-foreground">
                    Voir tous →
                  </Link>
                )}
              </div>
              <Card>
                <div className="divide-y">
                  {courriersEnAttente.slice(0, 20).map((c) => (
                    <Link
                      key={c.id}
                      to={`/courrier/${c.id}`}
                      className="flex items-center justify-between gap-3 px-3 py-3 transition-colors hover:bg-muted/50 md:px-4"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{c.subject ?? "(sans objet)"}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {new Date(c.received_at ?? c.created_at).toLocaleDateString("fr-FR")}
                          {c.assigned_service && (
                            <span className="ml-2 text-muted-foreground/70">— {c.assigned_service}</span>
                          )}
                        </p>
                      </div>
                      <span className="shrink-0 text-muted-foreground">→</span>
                    </Link>
                  ))}
                </div>
              </Card>
            </section>
          )}

          {/* En attente de signature */}
          {userSignatory && (pendingSignature?.length ?? 0) > 0 && (
            <section className="space-y-3">
              <div className="flex min-w-0 items-center gap-2">
                <PenLine className="h-4 w-4 shrink-0 text-muted-foreground" />
                <h2 className="min-w-0 text-base font-semibold">En attente de votre signature</h2>
                <Badge variant="secondary" className="shrink-0">{pendingSignature!.length}</Badge>
              </div>
              <Card>
                <div className="divide-y">
                  {pendingSignature!.map((c) => (
                    <Link
                      key={c.id}
                      to={
                        c.parent_courier_id
                          ? `/courrier/${c.parent_courier_id}?tab=response&replyId=${c.id}&edit=1`
                          : `/courrier/${c.id}`
                      }
                      className="flex items-center justify-between gap-3 px-3 py-3 transition-colors hover:bg-muted/50 md:px-4"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{c.subject ?? "(sans objet)"}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {new Date(c.created_at).toLocaleDateString("fr-FR")}
                        </p>
                      </div>
                      <span className="shrink-0 text-muted-foreground">→</span>
                    </Link>
                  ))}
                </div>
              </Card>
            </section>
          )}

        </div>
      )}

      {!organizationId && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Sélectionnez une organisation pour voir vos données.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
