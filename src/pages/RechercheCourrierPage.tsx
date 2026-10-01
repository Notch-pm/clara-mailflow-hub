import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useOrganization } from "@/contexts/OrganizationContext";
import { supabase } from "@/integrations/supabase/client";
import { listOrgsWithConfig } from "@/services/socleOrgConfigService";
import { listTags } from "@/services/courierTagService";
import { searchCouriers, type CourierSearchResult } from "@/services/courierSearchService";
import { useUserServiceFilter } from "@/hooks/useUserServiceFilter";
import { DataTable } from "@/components/data-table/data-table";
import { ListCellDate, ListCellText, ListCellTitle, StatusDot, type StatusTone } from "@/components/list/ListCells";
import {
  FilterChips,
  FilterOptionList,
  FilterSection,
  ListActiveFilters,
  ListFilterButton,
  type ActiveFilterChip,
} from "@/components/list/ListFilters";
import { ListDensityToggle, ListFooter, ListPage, ListSearch, ListToolbar } from "@/components/list/ListPage";
import type { Database } from "@/integrations/supabase/types";

const PAGE_SIZE = 20;

const DIRECTION_LABELS: Record<string, string> = {
  incoming: "Entrant",
  outgoing: "Sortant",
  inbound:  "Entrant",
  outbound: "Sortant",
};

const MATCH_IN_LABELS: Record<string, string> = {
  subject:      "objet",
  body:         "corps",
  participants: "participants",
  documents:    "documents",
};

type WorkflowCategory = Database["public"]["Enums"]["workflow_category"];

/** Teinte de l'état selon sa catégorie : à traiter, traité, archivé. */
const CATEGORY_TONE: Record<WorkflowCategory, StatusTone> = {
  pending: "warning",
  processing: "warning",
  processed: "primary",
  archived: "muted",
};

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

function formatDay(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("fr-FR");
}

export default function RechercheCourrierPage() {
  const { organizationId } = useOrganization();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [keywords, setKeywords] = useState(searchParams.get("q") ?? "");
  const [direction, setDirection] = useState(searchParams.get("direction") ?? "all");
  const [stateId, setStateId] = useState(searchParams.get("state") ?? "all");
  const [service, setService] = useState(searchParams.get("service") ?? "all");
  const [selectedTags, setSelectedTags] = useState<string[]>(() => {
    const raw = searchParams.get("tags");
    return raw ? raw.split(",").filter(Boolean) : [];
  });
  const [dateFrom, setDateFrom] = useState(searchParams.get("from") ?? "");
  const [dateTo, setDateTo] = useState(searchParams.get("to") ?? "");

  const debouncedKeywords = useDebounce(keywords, 300);

  // Sync filter state to URL
  useEffect(() => {
    const p: Record<string, string> = {};
    if (debouncedKeywords) p.q = debouncedKeywords;
    if (direction !== "all") p.direction = direction;
    if (stateId !== "all") p.state = stateId;
    if (service !== "all") p.service = service;
    if (selectedTags.length) p.tags = selectedTags.join(",");
    if (dateFrom) p.from = dateFrom;
    if (dateTo) p.to = dateTo;
    setSearchParams(p, { replace: true });
  }, [debouncedKeywords, direction, stateId, service, selectedTags, dateFrom, dateTo]);

  const resetFilters = useCallback(() => {
    setDirection("all");
    setStateId("all");
    setService("all");
    setSelectedTags([]);
    setDateFrom("");
    setDateTo("");
  }, []);

  // Workflow states
  const { data: allStates = [] } = useQuery({
    queryKey: ["all-workflow-states", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("workflow_states")
        .select("id, name, category");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; name: string; category: WorkflowCategory }>;
    },
    enabled: !!organizationId,
  });

  const stateById = useMemo(() => {
    const m = new Map<string, { name: string; category: WorkflowCategory }>();
    allStates.forEach((s) => m.set(s.id, s));
    return m;
  }, [allStates]);

  // Services
  const { data: services = [] } = useQuery({
    queryKey: ["socle-orgs-config", organizationId],
    queryFn: () => listOrgsWithConfig(organizationId),
    enabled: !!organizationId,
  });

  // Tags
  const { data: orgTags = [] } = useQuery({
    queryKey: ["courier-tags", organizationId],
    queryFn: () => listTags(organizationId),
    enabled: !!organizationId,
  });

  // Search query
  const queryKey = [
    "courier-search", organizationId,
    debouncedKeywords, direction, stateId, service, selectedTags.join(","), dateFrom, dateTo,
  ];

  const userServiceFilter = useUserServiceFilter();

  const {
    data,
    isLoading,
    isFetching,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useInfiniteQuery({
    queryKey: [...queryKey, userServiceFilter?.join(",") ?? "all"],
    queryFn: ({ pageParam = 0 }) =>
      searchCouriers({
        organizationId,
        keywords: debouncedKeywords || null,
        direction: direction !== "all" ? direction as "inbound" | "outbound" : null,
        workflowStateId: stateId !== "all" ? stateId : null,
        socleOrganizationId: service !== "all" ? service : null,
        // Filtré en SQL désormais. Le filtre était appliqué en JS APRÈS la
        // pagination : il retirait des lignes déjà comptées, ce qui faussait le
        // total affiché et créait des trous dans le défilement infini.
        visibleSocleOrganizationIds: userServiceFilter,
        tagNames: selectedTags.length ? selectedTags : null,
        dateFrom: dateFrom || null,
        dateTo: dateTo || null,
        limit: PAGE_SIZE,
        offset: pageParam as number,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((sum, p) => sum + p.results.length, 0);
      return loaded < lastPage.totalCount ? loaded : undefined;
    },
    enabled: !!organizationId,
  });

  const results = useMemo<CourierSearchResult[]>(() => data?.pages.flatMap((p) => p.results) ?? [], [data]);
  const totalCount = data?.pages[0]?.totalCount ?? 0;

  // La sentinelle vit dans la zone qui défile : l'observateur (racine = écran)
  // tient compte du rognage par cette zone, et se déclenche quand on en
  // approche le bas.
  const loadMoreRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!loadMoreRef.current || !hasNextPage) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting && !isFetchingNextPage) fetchNextPage(); },
      { threshold: 0.1 },
    );
    observer.observe(loadMoreRef.current);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, results.length]);

  const columns = useMemo<ColumnDef<CourierSearchResult>[]>(
    () => [
      {
        id: "subject",
        accessorFn: (r) => r.subject,
        header: "Objet",
        cell: ({ row }) => {
          const matchIn = row.original.match_in ?? [];
          return (
            <ListCellTitle
              title={row.original.subject || "Sans objet"}
              meta={
                matchIn.length
                  ? `Trouvé dans : ${matchIn.map((m) => MATCH_IN_LABELS[m] ?? m).join(" · ")}`
                  : undefined
              }
            />
          );
        },
        meta: { minWidth: 300 },
      },
      {
        id: "direction",
        accessorFn: (r) => DIRECTION_LABELS[r.direction] ?? r.direction,
        header: "Type",
        cell: ({ row }) => (
          <span className="inline-flex rounded-full bg-muted px-2.5 py-0.5 text-[11.5px] font-semibold text-muted-foreground">
            {DIRECTION_LABELS[row.original.direction] ?? row.original.direction}
          </span>
        ),
        meta: { width: 110 },
      },
      {
        id: "state",
        accessorFn: (r) => stateById.get(r.workflow_state_id ?? "")?.name ?? "",
        header: "État",
        cell: ({ row }) => {
          const state = stateById.get(row.original.workflow_state_id ?? "");
          return state ? <StatusDot label={state.name} tone={CATEGORY_TONE[state.category] ?? "muted"} /> : null;
        },
        meta: { width: 170 },
      },
      {
        id: "organisation",
        accessorFn: (r) => r.assigned_service ?? "",
        header: "Organisation",
        cell: ({ row }) => <ListCellText>{row.original.assigned_service ?? "—"}</ListCellText>,
        meta: { width: 190 },
      },
      {
        id: "received_at",
        accessorFn: (r) => r.received_at,
        header: "Reçu le",
        cell: ({ row }) => <ListCellDate value={row.original.received_at} />,
        meta: { width: 112, align: "right" },
      },
    ],
    [stateById],
  );

  const serviceName = services.find((s) => s.id === service)?.name;
  const stateName = stateById.get(stateId)?.name;
  const chips: ActiveFilterChip[] = [
    ...(direction !== "all"
      ? [{ key: "direction", label: `Type : ${direction === "inbound" ? "entrants" : "sortants"}`, onRemove: () => setDirection("all") }]
      : []),
    ...(stateName ? [{ key: "state", label: `État : ${stateName}`, onRemove: () => setStateId("all") }] : []),
    ...(serviceName ? [{ key: "service", label: `Organisation : ${serviceName}`, onRemove: () => setService("all") }] : []),
    ...selectedTags.map((t) => ({
      key: `tag:${t}`,
      label: `Tag : ${t}`,
      onRemove: () => setSelectedTags((cur) => cur.filter((x) => x !== t)),
    })),
    ...(dateFrom ? [{ key: "from", label: `Reçu depuis le ${formatDay(dateFrom)}`, onRemove: () => setDateFrom("") }] : []),
    ...(dateTo ? [{ key: "to", label: `Reçu jusqu'au ${formatDay(dateTo)}`, onRemove: () => setDateTo("") }] : []),
  ];

  return (
    <ListPage>
      <ListToolbar
        icon={<Search className="text-primary" />}
        title="Recherche"
        count={isLoading ? null : totalCount}
        countLabel="résultats"
        search={
          <ListSearch
            value={keywords}
            onChange={setKeywords}
            placeholder="Objet, correspondant…"
            ariaLabel="Rechercher dans les objets, expéditeurs, destinataires, textes"
          />
        }
      >
        <ListFilterButton
          title="Filtrer la recherche"
          activeCount={chips.length}
          resultLabel={isFetching && !isFetchingNextPage ? "…" : `${totalCount} résultat${totalCount > 1 ? "s" : ""}`}
          onReset={resetFilters}
        >
          <FilterSection label="Type">
            <FilterChips
              options={[
                { value: "inbound", label: "Entrants" },
                { value: "outbound", label: "Sortants" },
              ]}
              selected={direction === "all" ? [] : [direction]}
              onToggle={(v) => setDirection((cur) => (cur === v ? "all" : v))}
            />
          </FilterSection>
          {allStates.length > 0 && (
            <FilterSection label="État">
              <FilterOptionList
                options={allStates.map((s) => ({ value: s.id, label: s.name }))}
                selected={stateId === "all" ? [] : [stateId]}
                onToggle={(v) => setStateId((cur) => (cur === v ? "all" : v))}
              />
            </FilterSection>
          )}
          {services.length > 0 && (
            <FilterSection label="Organisation">
              <FilterOptionList
                options={services.map((s) => ({ value: s.id, label: s.name }))}
                selected={service === "all" ? [] : [service]}
                onToggle={(v) => setService((cur) => (cur === v ? "all" : v))}
              />
            </FilterSection>
          )}
          {orgTags.length > 0 && (
            <FilterSection label="Tags">
              <FilterChips
                options={orgTags.map((t) => ({ value: t.name, label: t.name, color: t.color }))}
                selected={selectedTags}
                onToggle={(name) =>
                  setSelectedTags((cur) => (cur.includes(name) ? cur.filter((t) => t !== name) : [...cur, name]))
                }
              />
            </FilterSection>
          )}
          <FilterSection label="Date de réception">
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1 text-[11.5px] text-muted-foreground">
                Du
                <Input type="date" className="h-8 text-sm" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              </label>
              <label className="flex flex-col gap-1 text-[11.5px] text-muted-foreground">
                Au
                <Input type="date" className="h-8 text-sm" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              </label>
            </div>
          </FilterSection>
        </ListFilterButton>
        <ListDensityToggle />
      </ListToolbar>
      <ListActiveFilters chips={chips} onReset={resetFilters} />

      <DataTable
        columns={columns}
        data={results}
        getRowId={(r) => r.id}
        isLoading={isLoading}
        onRowClick={(r) => navigate(`/courrier/${r.id}`)}
        itemLabel="résultat"
        // Une nouvelle recherche repart du haut de la liste.
        resetScrollKey={queryKey.join("|")}
        // Résultats rendus dans l'ordre du serveur ; un tri local ne porterait
        // que sur les pages déjà chargées.
        sortable={false}
        emptyMessage={
          <span className="flex flex-col items-center gap-3">
            <Search className="h-10 w-10 text-muted-foreground/30" />
            {debouncedKeywords
              ? `Aucun courrier ne correspond à « ${debouncedKeywords} »`
              : "Aucun courrier ne correspond aux filtres sélectionnés"}
          </span>
        }
        bodyEnd={
          hasNextPage && (
            <div ref={loadMoreRef} className="px-5 py-4">
              {isFetchingNextPage && (
                <div className="space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              )}
            </div>
          )
        }
        footer={
          <ListFooter>
            <p aria-live="polite">
              {isLoading ? (
                "Recherche…"
              ) : (
                <>
                  <span className="tabular-nums">{results.length.toLocaleString("fr-FR")}</span> affiché
                  {results.length > 1 ? "s" : ""} sur{" "}
                  <span className="tabular-nums">{totalCount.toLocaleString("fr-FR")}</span> résultat
                  {totalCount > 1 ? "s" : ""}
                  {debouncedKeywords ? ` pour « ${debouncedKeywords} »` : ""}
                </>
              )}
            </p>
          </ListFooter>
        }
      />
    </ListPage>
  );
}
