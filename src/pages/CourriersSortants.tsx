import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { Plus, RefreshCw, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ListDensityToggle,
  ListExportButton,
  ListMessage,
  ListPage,
  ListSearch,
  ListToolbar,
  ToolbarButton,
  ToolbarTooltip,
} from "@/components/list/ListPage";
import { FilterChips, FilterSection, ListActiveFilters, ListFilterButton } from "@/components/list/ListFilters";
import { buildCsv, downloadCsv } from "@/components/data-table/csv-export";
import { NewOutboundDialog } from "@/components/courier/outbound/NewOutboundDialog";
import OutboxCounters from "@/components/outbox/OutboxCounters";
import OutboxList from "@/components/outbox/OutboxList";
import { ParapheurDetail } from "@/components/parapheur/ParapheurDetail";
import { useOrganization } from "@/contexts/OrganizationContext";
import { channelLabels } from "@/hooks/useCourierWorkspace";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useOutbox, type OutboxPeriod } from "@/hooks/useOutbox";
import { applyServiceFilter, useUserServiceFilter } from "@/hooks/useUserServiceFilter";
import { OUTBOUND_KIND_LABELS, type OutboundKind } from "@/lib/outbound-kind";
import {
  EMPTY_OUTBOX_FILTERS,
  countOutboxViews,
  inOutboxView,
  isOutboxView,
  matchesOutboxFilters,
  OUTBOX_VIEWS,
  outboxTitle,
  sortOutbox,
  type OutboxFilters,
  type OutboxItem,
  type OutboxView,
} from "@/lib/outbox";
import { nextSelection } from "@/lib/parapheur";
import { assignableOrgs } from "@/services/socleOrgConfigService";
import type { CourierChannel } from "@/types/courier";

/** Liste et panneau côte à côte à partir de `lg` ; en dessous, un courrier s'ouvre dans sa fiche. */
const SPLIT_VIEW_QUERY = "(min-width: 1024px)";

const PERIODS: { value: OutboxPeriod; label: string }[] = [
  { value: 30, label: "30 jours" },
  { value: 90, label: "90 jours" },
  { value: 365, label: "1 an" },
];

const CHANNEL_OPTIONS = (["email", "paper"] as CourierChannel[]).map((value) => ({
  value,
  label: channelLabels[value] ?? value,
}));

const KIND_OPTIONS = (Object.keys(OUTBOUND_KIND_LABELS) as OutboundKind[]).map((value) => ({
  value,
  label: OUTBOUND_KIND_LABELS[value],
}));

const toggle = <T,>(list: T[], value: T): T[] =>
  list.includes(value) ? list.filter((x) => x !== value) : [...list, value];

/**
 * « Courriers sortants » — réponses et courriers à l'initiative, rangés par ce
 * qui les attend : rédaction, visa, signature, envoi, puis envoyés. Même
 * gabarit que « Courrier entrant » : compteurs-onglets, liste, et à droite la
 * relecture avec l'action de l'étape (celle du parapheur).
 */
export default function CourriersSortants() {
  const { organizationId } = useOrganization();
  const navigate = useNavigate();
  const splitView = useMediaQuery(SPLIT_VIEW_QUERY);
  const [searchParams, setSearchParams] = useSearchParams();
  const userServiceFilter = useUserServiceFilter();

  // `?vue=signature` : arrivée sur le bon onglet depuis un lien.
  const [view, setView] = useState<OutboxView>(() => {
    const requested = searchParams.get("vue");
    return isOutboxView(requested) ? requested : "redaction";
  });
  const [period, setPeriod] = useState<OutboxPeriod>(30);
  const [filters, setFilters] = useState<OutboxFilters>(EMPTY_OUTBOX_FILTERS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const outbox = useOutbox(organizationId, period);
  const services = useMemo(() => assignableOrgs(outbox.orgs), [outbox.orgs]);

  // « Synchronisé il y a … » : relu toutes les 30 s.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  // Mes services, plus les organisations dont je vise ou signe les sortants.
  const visibleOrgIds = useMemo(
    () => (userServiceFilter === null ? null : [...userServiceFilter, ...outbox.approvalOrgIds]),
    [userServiceFilter, outbox.approvalOrgIds],
  );
  const visible = useMemo(
    () => applyServiceFilter(outbox.items.map((i) => ({ ...i, socle_organization_id: i.row.socle_organization_id })), visibleOrgIds),
    [outbox.items, visibleOrgIds],
  );
  const filtered = useMemo<OutboxItem[]>(() => visible.filter((i) => matchesOutboxFilters(i, filters)), [visible, filters]);
  const counts = useMemo(() => countOutboxViews(filtered), [filtered]);
  const shown = useMemo(() => sortOutbox(filtered.filter((i) => inOutboxView(i, view)), view), [filtered, view]);
  const ids = useMemo(() => shown.map((i) => i.row.id), [shown]);

  // `?open=<id>` : ouvre l'onglet du courrier et le sélectionne.
  useEffect(() => {
    const openId = searchParams.get("open");
    if (!openId || !outbox.items.length) return;
    const target = outbox.items.find((i) => i.row.id === openId);
    setSearchParams({}, { replace: true });
    if (!target) return;
    if (!splitView) {
      navigate(`/courrier/${openId}`);
      return;
    }
    setView(target.stage);
    setSelectedId(openId);
  }, [searchParams, outbox.items, splitView, navigate, setSearchParams]);

  // Panneau jamais vide : le premier courrier de la vue, à défaut de sélection.
  const selected = shown.find((i) => i.row.id === selectedId) ?? (splitView ? shown[0] : undefined) ?? null;

  const orgName = (id: string | null) => (id ? (outbox.orgs.find((o) => o.id === id)?.name ?? null) : null);

  function handleSelect(id: string) {
    if (!splitView) {
      navigate(`/courrier/${id}`);
      return;
    }
    setSelectedId(id);
  }

  function changeView(next: OutboxView) {
    setView(next);
    setSelectedId(null);
  }

  function exportCsv() {
    const csv = buildCsv(shown, [
      { header: "Référence", accessor: (i) => i.row.chrono ?? i.row.parent_chrono ?? "" },
      { header: "Type", accessor: (i) => OUTBOUND_KIND_LABELS[i.kind] },
      { header: "Objet", accessor: (i) => outboxTitle(i) },
      { header: "Destinataire", accessor: (i) => i.row.recipient_name ?? "" },
      { header: "Canal", accessor: (i) => channelLabels[i.row.channel as CourierChannel] ?? i.row.channel },
      { header: "Organisation", accessor: (i) => orgName(i.row.socle_organization_id) ?? "" },
      { header: "Étape", accessor: (i) => OUTBOX_VIEWS[i.stage].label },
      { header: "État", accessor: (i) => i.row.state_name ?? "" },
      { header: "Attente (jours)", accessor: (i) => (i.stage === "envoyes" ? "" : i.waitingDays) },
      { header: "Envoyé le", accessor: (i) => (i.sentOn ? new Date(i.sentOn).toLocaleDateString("fr-FR") : "") },
    ]);
    downloadCsv(csv, `courriers-sortants-${view}-${new Date().toISOString().slice(0, 10)}.csv`);
  }

  const trimmedQuery = filters.query.trim();
  const activeChips = [
    ...(trimmedQuery
      ? [{ key: "search", label: `Recherche : « ${trimmedQuery} »`, onRemove: () => setFilters((f) => ({ ...f, query: "" })) }]
      : []),
    ...filters.kinds.map((k) => ({
      key: `kind:${k}`,
      label: OUTBOUND_KIND_LABELS[k],
      onRemove: () => setFilters((f) => ({ ...f, kinds: f.kinds.filter((x) => x !== k) })),
    })),
    ...filters.channels.map((c) => ({
      key: `channel:${c}`,
      label: channelLabels[c as CourierChannel] ?? c,
      onRemove: () => setFilters((f) => ({ ...f, channels: f.channels.filter((x) => x !== c) })),
    })),
    ...(filters.serviceId
      ? [{ key: "service", label: orgName(filters.serviceId) ?? "Organisation", onRemove: () => setFilters((f) => ({ ...f, serviceId: null })) }]
      : []),
    ...(period !== 30 ? [{ key: "period", label: `Envoyés : ${PERIODS.find((p) => p.value === period)?.label}`, onRemove: () => setPeriod(30) }] : []),
  ];
  const resetFilters = () => {
    setFilters(EMPTY_OUTBOX_FILTERS);
    setPeriod(30);
  };

  const newCourier = (
    <>
      <ToolbarTooltip label="Nouveau courrier" hideFromXl>
        <ToolbarButton
          primary
          icon={<Plus />}
          label="Nouveau courrier"
          text="Nouveau"
          showLabel
          onClick={() => setDialogOpen(true)}
        />
      </ToolbarTooltip>
      {organizationId && (
        <NewOutboundDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          organizationId={organizationId}
          services={outbox.orgs}
          userServiceFilter={userServiceFilter}
        />
      )}
    </>
  );

  return (
    <ListPage>
      <ListToolbar
        icon={<Send className="text-warning" />}
        title="Courriers sortants"
        count={outbox.isLoading ? null : counts.visa + counts.signature + counts.envoi}
        countLabel="courriers en circuit de validation ou d'envoi"
        primary={newCourier}
      >
        <ListFilterButton
          title="Filtrer les courriers"
          activeCount={activeChips.length}
          resultLabel={`${filtered.length} courrier${filtered.length > 1 ? "s" : ""}`}
          onReset={resetFilters}
        >
          <FilterSection label="Recherche">
            <ListSearch
              value={filters.query}
              onChange={(query) => setFilters((f) => ({ ...f, query }))}
              placeholder="Objet, référence, destinataire…"
              ariaLabel="Rechercher un courrier sortant"
              focusOnOpen
            />
          </FilterSection>
          <FilterSection label="Type">
            <FilterChips
              options={KIND_OPTIONS}
              selected={filters.kinds}
              onToggle={(k) => setFilters((f) => ({ ...f, kinds: toggle(f.kinds, k as OutboundKind) }))}
            />
          </FilterSection>
          <FilterSection label="Canal">
            <FilterChips
              options={CHANNEL_OPTIONS}
              selected={filters.channels}
              onToggle={(c) => setFilters((f) => ({ ...f, channels: toggle(f.channels, c) }))}
            />
          </FilterSection>
          <FilterSection label="Organisation">
            <Select
              value={filters.serviceId ?? "all"}
              onValueChange={(v) => setFilters((f) => ({ ...f, serviceId: v === "all" ? null : v }))}
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toutes les organisations</SelectItem>
                {services.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterSection>
          <FilterSection label="Courriers envoyés depuis">
            <FilterChips
              options={PERIODS.map((p) => ({ value: String(p.value), label: p.label }))}
              selected={[String(period)]}
              onToggle={(v) => setPeriod(Number(v) as OutboxPeriod)}
            />
          </FilterSection>
        </ListFilterButton>
        <span className="hidden items-center gap-1 rounded-lg border pl-3 pr-1 text-[13px] text-muted-foreground xl:flex">
          {outbox.updatedAt
            ? `Synchronisé ${formatDistanceToNow(new Date(outbox.updatedAt), { addSuffix: true, locale: fr })}`
            : "Synchronisation…"}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            title="Actualiser"
            onClick={() => outbox.refetch()}
            disabled={outbox.isFetching}
          >
            <RefreshCw className={outbox.isFetching ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          </Button>
        </span>
        <ListDensityToggle />
        <ListExportButton onClick={exportCsv} busy={false} disabled={shown.length === 0} />
      </ListToolbar>

      {!organizationId ? (
        <ListMessage>Veuillez sélectionner une organisation.</ListMessage>
      ) : outbox.error ? (
        <ListMessage>Les courriers sortants n'ont pas pu être chargés : {(outbox.error as Error).message}</ListMessage>
      ) : (
        <>
          <OutboxCounters counts={counts} view={view} onChange={changeView} />
          <ListActiveFilters chips={activeChips} onReset={resetFilters} />
          <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
            <OutboxList
              view={view}
              items={shown}
              selectedId={selected?.row.id ?? null}
              onSelect={handleSelect}
              orgName={orgName}
              isLoading={outbox.isLoading}
              filtered={activeChips.length > 0}
            />
            {splitView && (
              <aside
                className="flex w-[480px] min-w-0 shrink-0 flex-col border-l bg-background xl:w-[560px]"
                aria-label="Courrier sélectionné"
              >
                {selected ? (
                  <ParapheurDetail
                    key={selected.row.id}
                    replyId={selected.row.id}
                    showActions={selected.stage !== "envoyes"}
                    // Le courrier change d'étape : on passe au suivant de la vue.
                    onDone={() => setSelectedId(nextSelection(ids, selected.row.id, [selected.row.id]))}
                  />
                ) : (
                  <ListMessage>Sélectionnez un courrier.</ListMessage>
                )}
              </aside>
            )}
          </div>
        </>
      )}
    </ListPage>
  );
}
