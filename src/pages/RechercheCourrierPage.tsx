import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Search, X, ArrowDownUp, Filter, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useOrganization } from "@/contexts/OrganizationContext";
import { supabase } from "@/integrations/supabase/client";
import { listServices } from "@/services/orgServiceService";
import { listTags, type CourierTag } from "@/services/courierTagService";
import { searchCouriers, type CourierSearchResult } from "@/services/courierSearchService";
import { readableTextColor } from "@/lib/tag-color";

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

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

interface ResultRowProps {
  result: CourierSearchResult;
  stateName: string | undefined;
  onClick: () => void;
}

function ResultRow({ result, stateName, onClick }: ResultRowProps) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-4 py-3 border-b last:border-b-0 hover:bg-muted/50 transition-colors"
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="font-medium text-sm truncate">
              {result.subject || <span className="italic text-muted-foreground">Sans objet</span>}
            </span>
            <Badge variant="outline" className="text-[10px] shrink-0">
              {DIRECTION_LABELS[result.direction] ?? result.direction}
            </Badge>
            {stateName && (
              <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full shrink-0">
                {stateName}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
            <span>{formatDate(result.received_at)}</span>
            {result.assigned_service && <span>{result.assigned_service}</span>}
            {result.match_in?.length > 0 && (
              <span className="flex gap-1 flex-wrap">
                {result.match_in.map((m) => (
                  <span
                    key={m}
                    className="inline-flex items-center px-1 py-0 rounded bg-primary/10 text-primary text-[10px] font-medium"
                  >
                    {MATCH_IN_LABELS[m] ?? m}
                  </span>
                ))}
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}

interface TagFilterProps {
  tags: CourierTag[];
  selectedTags: string[];
  onChange: (names: string[]) => void;
}

function TagFilter({ tags, selectedTags, onChange }: TagFilterProps) {
  if (tags.length === 0) return null;

  function toggle(name: string) {
    onChange(
      selectedTags.includes(name)
        ? selectedTags.filter((t) => t !== name)
        : [...selectedTags, name],
    );
  }

  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground flex items-center gap-1">
        <Tag className="h-3 w-3" /> Tags
      </Label>
      <div className="flex flex-wrap gap-1">
        {tags.map((tag) => {
          const active = selectedTags.includes(tag.name);
          const bg = tag.color ?? "hsl(var(--muted-foreground))";
          return (
            <button
              key={tag.id}
              onClick={() => toggle(tag.name)}
              className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium transition-opacity border"
              style={
                active
                  ? { backgroundColor: bg, color: readableTextColor(bg), borderColor: bg }
                  : { backgroundColor: "transparent", color: bg, borderColor: bg, opacity: 0.6 }
              }
            >
              {tag.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface FilterPanelProps {
  direction: string;
  setDirection: (v: string) => void;
  stateId: string;
  setStateId: (v: string) => void;
  service: string;
  setService: (v: string) => void;
  selectedTags: string[];
  setSelectedTags: (v: string[]) => void;
  dateFrom: string;
  setDateFrom: (v: string) => void;
  dateTo: string;
  setDateTo: (v: string) => void;
  states: Array<{ id: string; name: string }>;
  services: Array<{ id: string; name: string }>;
  tags: CourierTag[];
  onReset: () => void;
}

function FilterPanel({
  direction, setDirection,
  stateId, setStateId,
  service, setService,
  selectedTags, setSelectedTags,
  dateFrom, setDateFrom,
  dateTo, setDateTo,
  states, services, tags,
  onReset,
}: FilterPanelProps) {
  const hasFilters =
    direction !== "all" || stateId !== "all" || service !== "all" ||
    selectedTags.length > 0 || dateFrom || dateTo;

  return (
    <aside className="w-64 shrink-0 border-r bg-muted/20 p-4 flex flex-col gap-4 overflow-y-auto">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold flex items-center gap-1.5">
          <Filter className="h-3.5 w-3.5" /> Filtres
        </span>
        {hasFilters && (
          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={onReset}>
            <X className="h-3 w-3 mr-1" />
            Réinitialiser
          </Button>
        )}
      </div>

      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Type</Label>
        <Select value={direction} onValueChange={setDirection}>
          <SelectTrigger className="h-8 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous</SelectItem>
            <SelectItem value="inbound">Courriers entrants</SelectItem>
            <SelectItem value="outbound">Courriers sortants</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">État</Label>
        <Select value={stateId} onValueChange={setStateId}>
          <SelectTrigger className="h-8 text-sm">
            <SelectValue placeholder="Tous" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous</SelectItem>
            {states.map((s) => (
              <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Service</Label>
        <Select value={service} onValueChange={setService}>
          <SelectTrigger className="h-8 text-sm">
            <SelectValue placeholder="Tous" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous</SelectItem>
            {services.map((s) => (
              <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <TagFilter tags={tags} selectedTags={selectedTags} onChange={setSelectedTags} />

      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Date de réception — du</Label>
        <Input
          type="date"
          className="h-8 text-sm"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
        />
      </div>

      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">au</Label>
        <Input
          type="date"
          className="h-8 text-sm"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
        />
      </div>
    </aside>
  );
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
        .select("id, name");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; name: string }>;
    },
    enabled: !!organizationId,
  });

  const stateById = useMemo(() => {
    const m = new Map<string, string>();
    allStates.forEach((s) => m.set(s.id, s.name));
    return m;
  }, [allStates]);

  // Services
  const { data: services = [] } = useQuery({
    queryKey: ["org-services", organizationId],
    queryFn: () => listServices(organizationId),
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

  const {
    data,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam = 0 }) =>
      searchCouriers({
        organizationId,
        keywords: debouncedKeywords || null,
        direction: direction !== "all" ? direction as "inbound" | "outbound" : null,
        workflowStateId: stateId !== "all" ? stateId : null,
        service: service !== "all" ? service : null,
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

  const results: CourierSearchResult[] = data?.pages.flatMap((p) => p.results) ?? [];
  const totalCount = data?.pages[0]?.totalCount ?? 0;

  const loadMoreRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!loadMoreRef.current || !hasNextPage) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting && !isFetchingNextPage) fetchNextPage(); },
      { threshold: 0.1 },
    );
    observer.observe(loadMoreRef.current);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return (
    <div className="flex h-full overflow-hidden">
      <FilterPanel
        direction={direction} setDirection={setDirection}
        stateId={stateId} setStateId={setStateId}
        service={service} setService={setService}
        selectedTags={selectedTags} setSelectedTags={setSelectedTags}
        dateFrom={dateFrom} setDateFrom={setDateFrom}
        dateTo={dateTo} setDateTo={setDateTo}
        states={allStates}
        services={services}
        tags={orgTags}
        onReset={resetFilters}
      />

      <section aria-label="Résultats de recherche" className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Search bar */}
        <div className="px-4 py-3 border-b bg-background sticky top-0 z-10">
          <div className="relative max-w-2xl">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9 pr-9"
              placeholder="Rechercher dans les objets, expéditeurs, destinataires, textes…"
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              
            />
            {keywords && (
              <button
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setKeywords("")}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {!isLoading && (
            <p className="text-xs text-muted-foreground mt-1.5 flex items-center gap-1">
              <ArrowDownUp className="h-3 w-3" />
              {totalCount} résultat{totalCount !== 1 ? "s" : ""}
              {debouncedKeywords ? ` pour « ${debouncedKeywords} »` : ""}
            </p>
          )}
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="space-y-0">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="px-4 py-3 border-b">
                  <Skeleton className="h-4 w-3/4 mb-2" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              ))}
            </div>
          ) : results.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-6 py-12">
              <Search className="h-10 w-10 text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground">
                {debouncedKeywords
                  ? `Aucun courrier ne correspond à « ${debouncedKeywords} »`
                  : "Aucun courrier ne correspond aux filtres sélectionnés"}
              </p>
            </div>
          ) : (
            <div>
              {results.map((r) => (
                <ResultRow
                  key={r.id}
                  result={r}
                  stateName={r.workflow_state_id ? stateById.get(r.workflow_state_id) : undefined}
                  onClick={() => navigate(`/courrier/${r.id}`)}
                />
              ))}
              <div ref={loadMoreRef} className="py-4 text-center">
                {isFetchingNextPage && (
                  <div className="space-y-2 px-4">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-1/3" />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
