import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { FileClock } from "lucide-react";
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

export default function CourriersEnInstruction() {
  const { organizationId } = useOrganization();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");

  // Processing states for the org
  const { data: processingStates } = useQuery({
    queryKey: ["processing-states", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("workflow_states")
        .select("id, name, workflow_id")
        .eq("category", "processing");
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!organizationId,
  });

  const stateById = useMemo(() => {
    const m = new Map<string, { id: string; name: string }>();
    (processingStates ?? []).forEach((s) => m.set(s.id, { id: s.id, name: s.name }));
    return m;
  }, [processingStates]);

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

  // Couriers in processing states
  const stateIds = useMemo(
    () => (processingStates ?? []).map((s) => s.id),
    [processingStates],
  );

  const facets = useCourierFacets({ services, states: processingStates, tags, withPeriod: true });
  const userServiceFilter = useUserServiceFilter();
  const debouncedSearch = useDebouncedValue(search, 300);

  // Tout est filtré en SQL. Auparavant service/état/tag étaient appliqués en JS
  // sur les 200 lignes déjà chargées : choisir un tag ne cherchait donc que dans
  // cette fenêtre, et la liste était incomplète dès quelques centaines de courriers.
  const filters = useMemo<CourierListFilters | null>(() => {
    if (!organizationId || !stateIds.length) return null;
    // Les états choisis restreignent l'ensemble ; l'intersection évite qu'une
    // valeur obsolète n'élargisse le périmètre de la page.
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

  // updated_at : les dossiers qui viennent de bouger d'abord. Aucun en-tête ne
  // porte cette colonne, aucune flèche n'est donc visible au chargement.
  const list = useCourierList(filters, {
    queryKeyPrefix: "instruction-couriers",
    defaultSort: { key: "updated_at", dir: "desc" },
  });

  const [tableInstance, onTableInstanceChange] = useDataTableInstance<CourierListRow>();
  const { exportCsv, isExporting } = useCourierCsvExport(list.filters, tableInstance, "courriers-en-instruction");

  const columns = useMemo<ColumnDef<CourierListRow>[]>(
    () => [
      subjectColumn("sender"),
      stateColumn(stateById, "warning"),
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
    ],
    [stateById, tagByName],
  );

  return (
    <ListPage>
      <ListToolbar
        icon={<FileClock className="text-primary" />}
        title="Courriers en instruction"
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
              ? "Aucun courrier en instruction ne correspond à ces critères."
              : "Aucun courrier en cours d'instruction."
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
