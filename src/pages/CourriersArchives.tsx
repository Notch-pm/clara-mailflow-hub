import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Archive } from "lucide-react";
import { useOrganization } from "@/contexts/OrganizationContext";
import { supabase } from "@/integrations/supabase/client";
import { listTags } from "@/services/courierTagService";
import { listOrgsWithConfig } from "@/services/socleOrgConfigService";
import { useUserServiceFilter } from "@/hooks/useUserServiceFilter";
import { useCourierList } from "@/hooks/useCourierList";
import { useCourierFacets } from "@/hooks/useCourierFacets";
import { useCourierCsvExport } from "@/hooks/useCourierCsvExport";
import type { CourierListFilters, CourierListRow } from "@/services/courierListService";
import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnToggle } from "@/components/data-table/data-table-column-toggle";
import { DataTableGroupingMenu } from "@/components/data-table/data-table-grouping-menu";
import { useDataTableInstance } from "@/components/data-table/use-data-table-instance";
import { ListActiveFilters, ListFilterButton } from "@/components/list/ListFilters";
import { ListDensityToggle, ListExportButton, ListMessage, ListPage, ListToolbar } from "@/components/list/ListPage";
import { CourierFacetFields } from "@/components/courier/CourierFacetFields";
import {
  dateColumn,
  organisationColumn,
  recipientColumn,
  stateColumn,
  subjectColumn,
  tagsColumn,
} from "@/components/courier/courierListColumns";

export default function CourriersArchives() {
  const { organizationId } = useOrganization();
  const navigate = useNavigate();

  // Archived states for the org
  const { data: archivedStates } = useQuery({
    queryKey: ["archived-states", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("workflow_states")
        .select("id, name, workflow_id")
        .eq("category", "archived");
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!organizationId,
  });

  const stateById = useMemo(() => {
    const m = new Map<string, { id: string; name: string }>();
    (archivedStates ?? []).forEach((s) => m.set(s.id, { id: s.id, name: s.name }));
    return m;
  }, [archivedStates]);

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
    () => (archivedStates ?? []).map((s) => s.id),
    [archivedStates],
  );

  const facets = useCourierFacets({ services, states: archivedStates, tags, withPeriod: true });
  const userServiceFilter = useUserServiceFilter();

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
      keywords: facets.keywords || null,
      prefixMatch: true,
      visibleSocleOrganizationIds: userServiceFilter,
    };
  }, [organizationId, stateIds, facets.stateIds, facets.serviceId, facets.tagNames, facets.dateFrom, facets.keywords, userServiceFilter]);

  // updated_at : les archivages les plus récents d'abord. À ne pas confondre
  // avec la colonne « Archivé le » ci-dessous, calculée par une seconde requête
  // sur la seule page affichée et donc intriable côté serveur.
  const list = useCourierList(filters, {
    queryKeyPrefix: "archives-couriers",
    defaultSort: { key: "updated_at", dir: "desc" },
  });

  // Date d'archivage : dernier passage dans un état archivé, sur la page affichée.
  const courierIds = useMemo(() => list.rows.map((c) => c.id), [list.rows]);
  const { data: archivedAtMap } = useQuery({
    queryKey: ["archives-archived-at", organizationId, courierIds, stateIds],
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
  const { exportCsv, isExporting } = useCourierCsvExport(list.filters, tableInstance, "courriers-archives");

  const columns = useMemo<ColumnDef<CourierListRow>[]>(
    () => [
      subjectColumn("sender"),
      stateColumn(stateById, "muted"),
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
        id: "archived_at",
        title: "Archivé le",
        exportLabel: "Date d'archivage",
        groupLabel: "Mois d'archivage",
        value: (c) => archivedAtMap?.[c.id],
      }),
    ],
    [stateById, tagByName, archivedAtMap],
  );

  return (
    <ListPage>
      <ListToolbar
        icon={<Archive className="text-primary" />}
        title="Courriers archivés"
        count={list.filters && !list.isLoading ? list.totalCount : null}
        countLabel="courriers"
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
            facets.activeCount
              ? "Aucun courrier archivé ne correspond à ces critères."
              : "Aucun courrier archivé."
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
