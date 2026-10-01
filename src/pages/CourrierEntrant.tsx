import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { ChevronDown, Files, Inbox, Info, PencilLine, Plus, RefreshCw } from "lucide-react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ListDensityToggle, ListMessage, ListPage, ListSearch, ListToolbar } from "@/components/list/ListPage";
import { FilterChips, FilterSection, ListActiveFilters, ListFilterButton } from "@/components/list/ListFilters";
import NewCourierDialog from "@/components/courier/NewCourierDialog";
import MailroomCounters from "@/components/mailroom/MailroomCounters";
import MailroomList from "@/components/mailroom/MailroomList";
import MailroomPanel from "@/components/mailroom/MailroomPanel";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/contexts/OrganizationContext";
import { useMailroom, type MailroomPeriod } from "@/hooks/useMailroom";
import { useMailroomActions } from "@/hooks/useMailroomActions";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { channelLabels } from "@/hooks/useCourierWorkspace";
import { canAccessMailroom, canEditCouriers } from "@/lib/permissions";
import { TRASH_RETENTION_DAYS } from "@/lib/trash";
import {
  analysisCandidates,
  batchCandidates,
  countViews,
  inView,
  matchesFilters,
  sortForView,
  type MailroomFilters,
  type MailroomItem,
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

  const [view, setView] = useState<MailroomView>("aq");
  const [period, setPeriod] = useState<MailroomPeriod>(30);
  const [filters, setFilters] = useState<MailroomFilters>({ query: "", channels: [], serviceId: null });
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
  const shown = useMemo(() => sortForView(filtered.filter((i) => inView(i, view)), view), [filtered, view]);
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
    setView((Object.keys(VIEW_OF_STAGE) as MailroomView[]).find((v) => VIEW_OF_STAGE[v] === target.stage) ?? "tous");
    setSelectedId(openId);
  }, [searchParams, mailroom.items, splitView, navigate, setSearchParams]);

  // Sélection d'office du premier courrier de la vue (panneau jamais vide), et
  // repli quand le courrier sélectionné quitte la vue (routé, par exemple).
  const selected = shown.find((i) => i.row.id === selectedId) ?? (splitView ? shown[0] : undefined) ?? null;

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
    );
  }

  const activeChips = [
    ...filters.channels.map((c) => ({
      key: `channel:${c}`,
      label: channelLabels[c as keyof typeof channelLabels] ?? c,
      onRemove: () => setFilters((f) => ({ ...f, channels: f.channels.filter((x) => x !== c) })),
    })),
    ...(filters.serviceId
      ? [{ key: "service", label: orgName(filters.serviceId) ?? "Service", onRemove: () => setFilters((f) => ({ ...f, serviceId: null })) }]
      : []),
    ...(period !== 30
      ? [{ key: "period", label: `Traités : ${period} jours`, onRemove: () => setPeriod(30) }]
      : []),
  ];
  const resetFilters = () => {
    setFilters((f) => ({ ...f, channels: [], serviceId: null }));
    setPeriod(30);
  };

  if (profileLoaded && !canAccessMailroom(profile, membership)) return <Navigate to="/boite-aux-lettres" replace />;

  return (
    <ListPage>
      <ListToolbar
        icon={<Inbox />}
        title="Courrier entrant"
        count={mailroom.isLoading ? null : counts.aq + counts.av + counts.retour}
        countLabel="courriers à router"
        search={
          <ListSearch
            value={filters.query}
            onChange={(query) => setFilters((f) => ({ ...f, query }))}
            placeholder="Rechercher un courrier, un expéditeur…"
          />
        }
        primary={
          organizationId && canEdit ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" className="h-9 gap-1.5 font-bold">
                  <Plus className="h-4 w-4" />
                  <span className="hidden sm:inline">Ajouter du courrier</span>
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-80 p-1.5">
                <DropdownMenuItem className="items-start gap-3 py-2.5" onSelect={() => setNewDialogOpen(true)}>
                  <PencilLine className="mt-0.5 h-4 w-4 text-primary" />
                  <span className="flex flex-col">
                    <span className="font-bold">Saisir un courrier</span>
                    <span className="text-[13px] text-muted-foreground">Créer manuellement un courrier reçu</span>
                  </span>
                </DropdownMenuItem>
                <DropdownMenuItem className="items-start gap-3 py-2.5" onSelect={() => navigate("/import-en-masse")}>
                  <Files className="mt-0.5 h-4 w-4 text-primary" />
                  <span className="flex flex-col">
                    <span className="font-bold">Importer plusieurs courriers</span>
                    <span className="text-[13px] text-muted-foreground">Saisie en masse à partir de fichiers</span>
                  </span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <p className="flex gap-2 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Les courriers reçus par email et par numérisation arrivent automatiquement.
                </p>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : undefined
        }
      >
        <ListFilterButton
          title="Filtrer le courrier"
          activeCount={activeChips.length}
          resultLabel={`${filtered.length} courrier${filtered.length > 1 ? "s" : ""}`}
          onReset={resetFilters}
        >
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
              onAnalyze={() => actions.analyze.mutate(toAnalyze.map((i) => i.row.id))}
              filtered={activeChips.length > 0 || !!filters.query.trim()}
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
                    onRoute={(courierId, org) => actions.route.mutate({ courierId, org })}
                    onReassign={(courierId, org) => actions.reassign.mutate({ courierId, org })}
                    onRemind={(courierId) => actions.remind.mutate(courierId)}
                    onAnalyze={(courierId) => actions.analyze.mutate([courierId])}
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

/** Onglet où apparaît chaque étape (lien `?open=`). */
const VIEW_OF_STAGE: Partial<Record<MailroomView, string>> = {
  aq: "to_qualify",
  av: "to_validate",
  retour: "to_reorient",
  cours: "routed",
  retard: "late",
  traites: "done",
};
