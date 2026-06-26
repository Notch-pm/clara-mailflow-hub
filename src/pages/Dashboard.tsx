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
    <Card className={href ? "hover:shadow-airbnb transition-shadow cursor-pointer h-full" : "h-full"}>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <Icon className={`h-5 w-5 shrink-0 ${iconColor}`} />
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-9 w-16" />
        ) : (
          <div className="text-3xl font-bold">{value}</div>
        )}
        {sub && <p className="text-xs text-muted-foreground mt-1 capitalize">{sub}</p>}
      </CardContent>
    </Card>
  );
  return href ? <Link to={href} className="block">{inner}</Link> : inner;
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
  const { data: rawInbound, isLoading: loadingCouriers } = useQuery({
    queryKey: ["dashboard-inbound", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("couriers")
        .select("id, subject, received_at, created_at, updated_at, workflow_state_id, assigned_service")
        .eq("organization_id", organizationId!)
        .eq("direction", "inbound");
      if (error) throw error;
      return data ?? [];
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
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Tableau de bord</h1>
        <p className="text-muted-foreground">Vue d'ensemble de votre gestion du courrier</p>
      </div>

      <div className="grid gap-4 grid-cols-2 md:grid-cols-3">
        <KpiCard label="Courriers reçus"          value={recusMoisEnCours}    sub={currentMonthLabel} Icon={MailOpen}   iconColor="text-primary"         href="/boite-aux-lettres"        loading={loading} />
        <KpiCard label="Courriers reçus (M−1)"    value={recusMoisPrecedent}  sub={prevMonthLabel}    Icon={MailOpen}   iconColor="text-muted-foreground"                                  loading={loading} />
        <KpiCard label="En attente d'instruction" value={enAttente}                                   Icon={Clock}      iconColor="text-warning"          href="/boite-aux-lettres"        loading={loading} />
        <KpiCard label="En instruction"           value={enInstruction}                               Icon={FileText}   iconColor="text-blue-500"         href="/courriers-en-instruction" loading={loading} />
        <KpiCard label="Courriers traités"        value={traitesMoisEnCours}  sub={currentMonthLabel} Icon={FileCheck}  iconColor="text-secondary"        href="/courriers-traites"        loading={loading} />
        <KpiCard label="Courriers traités (M−1)"  value={traitesMoisPrecedent} sub={prevMonthLabel}   Icon={FileCheck}  iconColor="text-muted-foreground"                                  loading={loading} />
      </div>

      {/* Listes côte à côte — chacune prend toute la largeur si l'autre est absente */}
      {(courriersEnAttente.length > 0 || (userSignatory && (pendingSignature?.length ?? 0) > 0)) && (
        <div className={`grid gap-6 items-start ${courriersEnAttente.length > 0 && userSignatory && (pendingSignature?.length ?? 0) > 0 ? "lg:grid-cols-2" : ""}`}>

          {/* En attente de prise en charge */}
          {courriersEnAttente.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <h2 className="text-base font-semibold">En attente de prise en charge</h2>
                  <Badge variant="secondary">{courriersEnAttente.length}</Badge>
                </div>
                {courriersEnAttente.length > 20 && (
                  <Link to="/boite-aux-lettres" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
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
                      className="flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition-colors"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{c.subject ?? "(sans objet)"}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(c.received_at ?? c.created_at).toLocaleDateString("fr-FR")}
                          {c.assigned_service && (
                            <span className="ml-2 text-muted-foreground/70">— {c.assigned_service}</span>
                          )}
                        </p>
                      </div>
                      <span className="text-muted-foreground ml-4 shrink-0">→</span>
                    </Link>
                  ))}
                </div>
              </Card>
            </section>
          )}

          {/* En attente de signature */}
          {userSignatory && (pendingSignature?.length ?? 0) > 0 && (
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <PenLine className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-base font-semibold">En attente de votre signature</h2>
                <Badge variant="secondary">{pendingSignature!.length}</Badge>
              </div>
              <Card>
                <div className="divide-y">
                  {pendingSignature!.map((c) => (
                    <Link
                      key={c.id}
                      to={`/courrier/${c.id}`}
                      className="flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition-colors"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{c.subject ?? "(sans objet)"}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(c.created_at).toLocaleDateString("fr-FR")}
                        </p>
                      </div>
                      <span className="text-muted-foreground ml-4 shrink-0">→</span>
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
