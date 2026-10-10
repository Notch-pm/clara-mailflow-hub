import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { Inbox, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ListDensityToggle, ListMessage, ListPage, ListSearch, ListToolbar } from "@/components/list/ListPage";
import { FilterChips, FilterSection, ListActiveFilters, ListFilterButton } from "@/components/list/ListFilters";
import AddCourierMenu from "@/components/courier/AddCourierMenu";
import NewCourierDialog from "@/components/courier/NewCourierDialog";
import MailroomCounters from "@/components/mailroom/MailroomCounters";
import MailroomList from "@/components/mailroom/MailroomList";
import MailroomPanel from "@/components/mailroom/MailroomPanel";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/contexts/OrganizationContext";
import { useMailroom, type MailroomPeriod } from "@/hooks/useMailroom";
import { useMailroomActions } from "@/hooks/useMailroomActions";
import { useMailroomMoves } from "@/hooks/useMailroomMoves";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { channelLabels } from "@/hooks/useCourierWorkspace";
import { canAccessMailroom, canEditCouriers } from "@/lib/permissions";
import { TRASH_RETENTION_DAYS } from "@/lib/trash";
import {
  analysisCandidates,
  batchCandidates,
  countViews,
  inView,
  MAILROOM_VIEWS,
  matchesFilters,
  sortItems,
  viewOfStage,
  type MailroomFilters,
  type MailroomItem,
  type MailroomSort,
  type MailroomView,
} from "@/lib/mailroom";

/** Liste et panneau côte à côte à partir de `lg` ; en dessous, un courrier s'ouvre dans sa fiche. */
const SPLIT_VIEW_QUERY = "(min-width: 1024px)";

const PERIODS: { value: MailroomPeriod; label: string }[] = [
  { value: 7, label: "7 jours" },
  { value: 30, label: "30 jours" },
  { value: 90, label: "90 jours" },
];

const CHANNEL_OPTIONS = (Object.keys(channelLabels) as (keyof typeof channelLabels)[]).map((value) => ({
  value,
  label: channelLabels[value],
}));

/**
 * « Courrier entrant » — l'écran du gestionnaire courrier : qualifier (accepter
 * ou corriger la proposition de Clara), router vers le service gestionnaire,
 * puis suivre et relancer. Remplace pour lui la boîte aux lettres.
 */
export default function CourrierEntrant() {
  const { organizationId } = useOrganization();
  const { profile, membership, profileLoaded } = useAuth();
  const canEdit = canEditCouriers(profile, membership);
  const navigate = useNavigate();
  const splitView = useMediaQuery(SPLIT_VIEW_QUERY);
  const [searchParams, setSearchParams] = useSearchParams();

  // `?vue=av` : arrivée depuis une carte du tableau de bord, sur le bon onglet ;
  // `&retard=1` : réduit à ses retards. `?vue=retard` (ancien onglet, liens
  // gardés) vaut « En cours », retards seulement.
  const [view, setView] = useState<MailroomView>(() => {
    const requested = searchParams.get("vue");
    if (requested === "retard") return "cours";
    return requested && Object.prototype.hasOwnProperty.call(MAILROOM_VIEWS, requested) ? (requested as MailroomView) : "aq";
  });
  const [period, setPeriod] = useState<MailroomPeriod>(30);
  const [filters, setFilters] = useState<MailroomFilters>(() => ({
    ...EMPTY_FILTERS,
    lateOnly: searchParams.get("retard") === "1" || searchParams.get("vue") === "retard",
  }));
  const [sort, setSort] = useState<MailroomSort>("default");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newDialogOpen, setNewDialogOpen] = useState(false);
  const [toDelete, setToDelete] = useState<MailroomItem | null>(null);

  const mailroom = useMailroom(organizationId, period);
  const actions = useMailroomActions(organizationId ?? "");

  // « Synchronisé il y a … » : relu toutes les 30 s.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const filtered = useMemo(() => mailroom.items.filter((i) => matchesFilters(i, filters)), [mailroom.items, filters]);
  const counts = useMemo(() => countViews(filtered), [filtered]);
  const shown = useMemo(() => sortItems(filtered.filter((i) => inView(i, view)), view, sort), [filtered, view, sort]);
  const batch = useMemo(() => batchCandidates(filtered), [filtered]);
  const toAnalyze = useMemo(() => analysisCandidates(filtered), [filtered]);

  // `?open=<id>` (notification « renvoyé ») : ouvre l'onglet du courrier.
  useEffect(() => {
    const openId = searchParams.get("open");
    if (!openId || !mailroom.items.length) return;
    const target = mailroom.items.find((i) => i.row.id === openId);
    setSearchParams({}, { replace: true });
    if (!target) return;
    if (!splitView) {
      navigate(`/courrier/${openId}`);
      return;
    }
    setView(viewOfStage(target.stage) ?? "tous");
    setSelectedId(openId);
  }, [searchParams, mailroom.items, splitView, navigate, setSearchParams]);

  // Un courrier sur lequel on agit change d'onglet : la vue le suit (onglet,
  // ligne, panneau) et un toast dit où il s'est rangé — voir `useMailroomMoves`.
  const moves = useMailroomMoves({
    items: mailroom.items,
    updatedAt: mailroom.updatedAt,
    isFocused: (id) => selected?.row.id === id,
    isVisible: (id) => filtered.some((i) => i.row.id === id),
    show: (id, target) => {
      const item = filtered.find((i) => i.row.id === id);
      setSelectedId(id);
      // Encore visible dans l'onglet courant (« Tous », par exemple) : on y reste.
      if (item && !inView(item, view)) setView(target ?? "tous");
    },
  });

  // Sélection d'office du premier courrier de la vue (panneau jamais vide), et
  // repli quand le courrier sélectionné quitte la vue — sauf s'il est suivi :
  // le panneau le garde le temps que la liste relue dise où il est allé.
  const selected =
    shown.find((i) => i.row.id === selectedId) ??
    (selectedId && moves.followed.has(selectedId) ? filtered.find((i) => i.row.id === selectedId) : undefined) ??
    (splitView ? shown[0] : undefined) ??
    null;

  const orgName = (id: string | null) => (id ? (mailroom.orgs.find((o) => o.id === id)?.name ?? null) : null);
  const busy = actions.route.isPending || actions.reassign.isPending || actions.remind.isPending;

  function handleSelect(id: string) {
    if (!splitView) {
      navigate(`/courrier/${id}`);
      return;
    }
    setSelectedId(id);
  }

  function runBatch() {
    const byId = new Map(mailroom.assignable.map((o) => [o.id, o]));
    actions.routeBatch.mutate(
      batch
        .map((i) => ({ courierId: i.row.id, org: byId.get(i.row.suggested_socle_organization_id!) }))
        .filter((x): x is { courierId: string; org: NonNullable<typeof x.org> } => !!x.org),
      { onSuccess: ({ routed }) => routed.length > 0 && moves.track({ ids: routed, verb: "routé" }) },
    );
  }

  function analyze(courierIds: string[]) {
    actions.analyze.mutate(courierIds, {
      onSuccess: (queued) => queued > 0 && moves.track({ ids: courierIds, verb: "analysé", waitAnalysis: true }),
    });
  }

  // La recherche vit dans le panneau « Filtres », comme sur les autres listes :
  // sa pastille dit, panneau fermé, pourquoi la liste est réduite.
  const trimmedQuery = filters.query.trim();
  const activeChips = [
    ...(trimmedQuery
      ? [{ key: "search", label: `Recherche : « ${trimmedQuery} »`, onRemove: () => setFilters((f) => ({ ...f, query: "" })) }]
      : []),
    ...filters.channels.map((c) => ({
      key: `channel:${c}`,
      label: channelLabels[c as keyof typeof channelLabels] ?? c,
      onRemove: () => setFilters((f) => ({ ...f, channels: f.channels.filter((x) => x !== c) })),
    })),
    ...(filters.serviceId
      ? [{ key: "service", label: orgName(filters.serviceId) ?? "Service", onRemove: () => setFilters((f) => ({ ...f, serviceId: null })) }]
      : []),
    ...(filters.lateOnly
      ? [{ key: "late", label: "En retard uniquement", onRemove: () => setFilters((f) => ({ ...f, lateOnly: false })) }]
      : []),
    ...(period !== 30
      ? [{ key: "period", label: `Traités : ${period} jours`, onRemove: () => setPeriod(30) }]
      : []),
  ];
  const resetFilters = () => {
    setFilters(EMPTY_FILTERS);
    setPeriod(30);
  };

  if (profileLoaded && !canAccessMailroom(profile, membership)) return <Navigate to="/a-instruire" replace />;

  return (
    <ListPage>
      <ListToolbar
        icon={<Inbox />}
        title="Courrier entrant"
        count={mailroom.isLoading ? null : counts.aq + counts.av + counts.retour}
        countLabel="courriers à router"
        primary={
          organizationId && canEdit ? (
            <AddCourierMenu onNewCourier={() => setNewDialogOpen(true)} />
          ) : undefined
        }
      >
        <ListFilterButton
          title="Filtrer le courrier"
          activeCount={activeChips.length}
          resultLabel={`${filtered.length} courrier${filtered.length > 1 ? "s" : ""}`}
          onReset={resetFilters}
        >
          <FilterSection label="Recherche">
            <ListSearch
              value={filters.query}
              onChange={(query) => setFilters((f) => ({ ...f, query }))}
              placeholder="Objet, expéditeur…"
              ariaLabel="Rechercher un courrier, un expéditeur"
              focusOnOpen
            />
          </FilterSection>
          <FilterSection label="Délai">
            <FilterChips
              options={[{ value: "late", label: "En retard uniquement" }]}
              selected={filters.lateOnly ? ["late"] : []}
              onToggle={() => setFilters((f) => ({ ...f, lateOnly: !f.lateOnly }))}
            />
          </FilterSection>
          <FilterSection label="Canal">
            <FilterChips
              options={CHANNEL_OPTIONS}
              selected={filters.channels}
              onToggle={(c) =>
                setFilters((f) => ({
                  ...f,
                  channels: f.channels.includes(c) ? f.channels.filter((x) => x !== c) : [...f.channels, c],
                }))
              }
            />
          </FilterSection>
          <FilterSection label="Service">
            <Select
              value={filters.serviceId ?? "all"}
              onValueChange={(v) => setFilters((f) => ({ ...f, serviceId: v === "all" ? null : v }))}
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les services</SelectItem>
                {mailroom.assignable.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterSection>
          <FilterSection label="Courriers traités depuis">
            <FilterChips
              options={PERIODS.map((p) => ({ value: String(p.value), label: p.label }))}
              selected={[String(period)]}
              onToggle={(v) => setPeriod(Number(v) as MailroomPeriod)}
            />
          </FilterSection>
        </ListFilterButton>
        <span className="hidden items-center gap-1 rounded-lg border pl-3 pr-1 text-[13px] text-muted-foreground xl:flex">
          {mailroom.updatedAt
            ? `Synchronisé ${formatDistanceToNow(new Date(mailroom.updatedAt), { addSuffix: true, locale: fr })}`
            : "Synchronisation…"}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            title="Actualiser"
            onClick={() => mailroom.refetch()}
            disabled={mailroom.isFetching}
          >
            <RefreshCw className={mailroom.isFetching ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          </Button>
        </span>
        <ListDensityToggle />
      </ListToolbar>

      {!organizationId ? (
        <ListMessage>Veuillez sélectionner une organisation pour voir le courrier.</ListMessage>
      ) : mailroom.error ? (
        <ListMessage>Le courrier n'a pas pu être chargé : {(mailroom.error as Error).message}</ListMessage>
      ) : (
        <>
          <MailroomCounters counts={counts} view={view} onChange={(v) => { setView(v); setSelectedId(null); }} />
          <ListActiveFilters chips={activeChips} onReset={resetFilters} />
          <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
            <MailroomList
              view={view}
              items={shown}
              selectedId={selected?.row.id ?? null}
              onSelect={handleSelect}
              orgName={orgName}
              isLoading={mailroom.isLoading}
              analysingCount={counts.analysing}
              batchCount={canEdit ? batch.length : 0}
              batchBusy={actions.routeBatch.isPending}
              onBatch={runBatch}
              analyzeCount={canEdit ? toAnalyze.length : 0}
              analyzeBusy={actions.analyze.isPending}
              onAnalyze={() => analyze(toAnalyze.map((i) => i.row.id))}
              filtered={activeChips.length > 0 || !!filters.query.trim()}
              sort={sort}
              onSortChange={setSort}
            />
            {splitView && (
              <aside className="w-[440px] min-w-0 shrink-0 overflow-y-auto border-l bg-card xl:w-[480px]" aria-label="Courrier sélectionné">
                {selected ? (
                  <MailroomPanel
                    key={selected.row.id}
                    item={selected}
                    organizationId={organizationId}
                    orgs={mailroom.orgs}
                    assignable={mailroom.assignable}
                    canEdit={canEdit}
                    busy={busy}
                    onRoute={(courierId, org) =>
                      actions.route.mutate(
                        { courierId, org },
                        { onSuccess: (name) => moves.track({ ids: [courierId], verb: "routé", detail: `Transmis à ${name}` }) },
                      )
                    }
                    onReassign={(courierId, org) =>
                      actions.reassign.mutate(
                        { courierId, org },
                        { onSuccess: (name) => moves.track({ ids: [courierId], verb: "réaffecté", detail: `Transféré à ${name}` }) },
                      )
                    }
                    onRemind={(courierId) =>
                      actions.remind.mutate(courierId, {
                        onSuccess: (service) =>
                          moves.track({ ids: [courierId], verb: "relancé", detail: `Relance envoyée à ${service ?? "le service"}` }),
                      })
                    }
                    onAnalyze={(courierId) => analyze([courierId])}
                    analyzing={actions.analyze.isPending}
                    onDelete={canEdit ? setToDelete : undefined}
                  />
                ) : (
                  <ListMessage>Sélectionnez un courrier.</ListMessage>
                )}
              </aside>
            )}
          </div>
        </>
      )}

      <AlertDialog open={!!toDelete} onOpenChange={(open) => !open && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer ce courrier ?</AlertDialogTitle>
            <AlertDialogDescription>
              Le courrier
              {toDelete?.row.subject ? ` « ${toDelete.row.subject} »` : ""} sera placé dans la corbeille, avec
              ses réponses. Il pourra être restauré pendant {TRASH_RETENTION_DAYS} jours.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actions.remove.isPending}>Annuler</AlertDialogCancel>
            <AlertDialogAction
              disabled={actions.remove.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (!toDelete) return;
                const id = toDelete.row.id;
                actions.remove.mutate(id, {
                  onSettled: () => setToDelete(null),
                  onSuccess: () => setSelectedId((current) => (current === id ? null : current)),
                });
              }}
            >
              {actions.remove.isPending ? "Suppression…" : "Supprimer"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {organizationId && (
        <NewCourierDialog
          open={newDialogOpen}
          onOpenChange={setNewDialogOpen}
          organizationId={organizationId}
          onCreated={(id) => {
            mailroom.refetch();
            setView("tous");
            setSelectedId(id);
          }}
        />
      )}
    </ListPage>
  );
}

const EMPTY_FILTERS: MailroomFilters = { query: "", channels: [], serviceId: null, lateOnly: false };
