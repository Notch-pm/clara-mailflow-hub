import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { CheckCircle2 } from "lucide-react";
import { useOrganization } from "@/contexts/OrganizationContext";
import { supabase } from "@/integrations/supabase/client";
import { listTags } from "@/services/courierTagService";
import { listOrgsWithConfig } from "@/services/socleOrgConfigService";
import { useUserServiceFilter } from "@/hooks/useUserServiceFilter";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useCourierList } from "@/hooks/useCourierList";
import { useCourierFacets } from "@/hooks/useCourierFacets";
import { useCourierCsvExport } from "@/hooks/useCourierCsvExport";
import type { CourierListFilters, CourierListRow } from "@/services/courierListService";
import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnToggle } from "@/components/data-table/data-table-column-toggle";
import { DataTableGroupingMenu } from "@/components/data-table/data-table-grouping-menu";
import { useDataTableInstance } from "@/components/data-table/use-data-table-instance";
import { ListActiveFilters, ListFilterButton } from "@/components/list/ListFilters";
import { ListDensityToggle, ListExportButton, ListMessage, ListPage, ListSearch, ListToolbar } from "@/components/list/ListPage";
import { CourierFacetFields } from "@/components/courier/CourierFacetFields";
import {
  dateColumn,
  organisationColumn,
  recipientColumn,
  stateColumn,
  subjectColumn,
  tagsColumn,
} from "@/components/courier/courierListColumns";

export default function CourriersTraites() {
  const { organizationId } = useOrganization();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");

  // Processed states for the org (excludes archived)
  const { data: processedStates } = useQuery({
    queryKey: ["processed-states", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("workflow_states")
        .select("id, name, workflow_id")
        .eq("category", "processed");
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!organizationId,
  });

  const stateById = useMemo(() => {
    const m = new Map<string, { id: string; name: string }>();
    (processedStates ?? []).forEach((s) => m.set(s.id, { id: s.id, name: s.name }));
    return m;
  }, [processedStates]);

  // Org services & tags for filters
  const { data: services } = useQuery({
    queryKey: ["socle-orgs-config", organizationId],
    queryFn: () => listOrgsWithConfig(organizationId!),
    enabled: !!organizationId,
  });

  const { data: tags } = useQuery({
    queryKey: ["courier-tags", organizationId],
    queryFn: () => listTags(organizationId!),
    enabled: !!organizationId,
  });

  const tagByName = useMemo(() => {
    const m = new Map<string, { color: string | null }>();
    (tags ?? []).forEach((t) => m.set(t.name.toLowerCase(), { color: t.color }));
    return m;
  }, [tags]);

  const stateIds = useMemo(
    () => (processedStates ?? []).map((s) => s.id),
    [processedStates],
  );

  const facets = useCourierFacets({ services, states: processedStates, tags, withPeriod: true });
  const userServiceFilter = useUserServiceFilter();
  const debouncedSearch = useDebouncedValue(search, 300);

  const filters = useMemo<CourierListFilters | null>(() => {
    if (!organizationId || !stateIds.length) return null;
    const chosenStates = facets.stateIds.filter((id) => stateIds.includes(id));
    return {
      organizationId,
      direction: "inbound",
      workflowStateIds: chosenStates.length ? chosenStates : stateIds,
      socleOrganizationId: facets.serviceId,
      tagNames: facets.tagNames.length ? facets.tagNames : null,
      dateFrom: facets.dateFrom,
      keywords: debouncedSearch || null,
      prefixMatch: true,
      visibleSocleOrganizationIds: userServiceFilter,
    };
  }, [organizationId, stateIds, facets.stateIds, facets.serviceId, facets.tagNames, facets.dateFrom, debouncedSearch, userServiceFilter]);

  // updated_at : les traitements les plus récents d'abord. À ne pas confondre
  // avec la colonne « Traité le » ci-dessous, calculée par une seconde requête
  // sur la seule page affichée et donc intriable côté serveur.
  const list = useCourierList(filters, {
    queryKeyPrefix: "traites-couriers",
    defaultSort: { key: "updated_at", dir: "desc" },
  });

  // Date de traitement : dernier passage dans un état « traité ». Ne porte que
  // sur la page affichée, donc bien moins de lignes qu'avant.
  const courierIds = useMemo(() => list.rows.map((c) => c.id), [list.rows]);
  const { data: processedAtMap } = useQuery({
    queryKey: ["traites-processed-at", organizationId, courierIds, stateIds],
    queryFn: async () => {
      if (!organizationId || !courierIds.length || !stateIds.length) return {};
      const { data, error } = await supabase
        .from("courier_events")
        .select("courier_id, created_at, payload")
        .eq("organization_id", organizationId)
        .eq("event_type", "state_changed")
        .in("courier_id", courierIds)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const map: Record<string, string> = {};
      const stateSet = new Set(stateIds);
      for (const ev of data ?? []) {
        const toId = (ev.payload as Record<string, unknown> | null)?.to_id as string | undefined;
        if (toId && stateSet.has(toId) && !map[ev.courier_id]) {
          map[ev.courier_id] = ev.created_at as string;
        }
      }
      return map;
    },
    enabled: !!organizationId && courierIds.length > 0 && stateIds.length > 0,
  });

  const [tableInstance, onTableInstanceChange] = useDataTableInstance<CourierListRow>();
  const { exportCsv, isExporting } = useCourierCsvExport(list.filters, tableInstance, "courriers-traites");

  const columns = useMemo<ColumnDef<CourierListRow>[]>(
    () => [
      subjectColumn("sender"),
      stateColumn(stateById, "primary"),
      organisationColumn(),
      recipientColumn(),
      tagsColumn(tagByName),
      dateColumn({
        id: "received_at",
        title: "Reçu le",
        exportLabel: "Date de réception",
        groupLabel: "Mois de réception",
        value: (c) => c.received_at,
        sortable: true,
      }),
      // Non triable, et le rester : cette date vient de `courier_events`,
      // chargée par une requête à part pour les seuls courriers de la page
      // affichée. Le RPC ne la connaît pas.
      dateColumn({
        id: "processed_at",
        title: "Traité le",
        exportLabel: "Date de traitement",
        groupLabel: "Mois de traitement",
        value: (c) => processedAtMap?.[c.id],
      }),
    ],
    [stateById, tagByName, processedAtMap],
  );

  return (
    <ListPage>
      <ListToolbar
        icon={<CheckCircle2 className="text-primary" />}
        title="Courriers traités"
        count={list.filters && !list.isLoading ? list.totalCount : null}
        countLabel="courriers"
        search={<ListSearch value={search} onChange={setSearch} placeholder="Rechercher par objet…" />}
      >
        {tableInstance && <DataTableGroupingMenu table={tableInstance} />}
        <ListFilterButton
          title="Filtrer les courriers"
          activeCount={facets.activeCount}
          resultLabel={list.isFetching ? "…" : `${list.totalCount} résultat${list.totalCount > 1 ? "s" : ""}`}
          onReset={facets.reset}
        >
          <CourierFacetFields facets={facets} />
        </ListFilterButton>
        <ListDensityToggle />
        {tableInstance && <DataTableColumnToggle table={tableInstance} />}
        <ListExportButton onClick={exportCsv} busy={isExporting} disabled={!list.totalCount} />
      </ListToolbar>
      <ListActiveFilters chips={facets.chips} onReset={facets.reset} />

      {!organizationId ? (
        <ListMessage>Veuillez sélectionner une organisation.</ListMessage>
      ) : (
        <DataTable
          columns={columns}
          data={list.rows}
          isLoading={list.isLoading}
          onRowClick={(c) => navigate(`/courrier/${c.id}`)}
          onTableInstanceChange={onTableInstanceChange}
          sorting={list.sorting}
          onSortingChange={list.onSortingChange}
          emptyMessage={
            facets.activeCount || debouncedSearch
              ? "Aucun courrier traité ne correspond à ces critères."
              : "Aucun courrier traité."
          }
          pagination={{
            page: list.page,
            pageCount: list.pageCount,
            pageSize: list.pageSize,
            totalCount: list.totalCount,
            onPageChange: list.setPage,
            onPageSizeChange: list.setPageSize,
            isLoading: list.isFetching,
          }}
        />
      )}
    </ListPage>
  );
}
