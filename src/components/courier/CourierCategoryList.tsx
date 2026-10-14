import { useMemo, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useOrganization } from "@/contexts/OrganizationContext";
import { supabase } from "@/integrations/supabase/client";
import { listTags } from "@/services/courierTagService";
import { listOrgsWithConfig } from "@/services/socleOrgConfigService";
import { useUserServiceFilter } from "@/hooks/useUserServiceFilter";
import { useCourierList } from "@/hooks/useCourierList";
import { useCourierFacets } from "@/hooks/useCourierFacets";
import { useCourierCsvExport } from "@/hooks/useCourierCsvExport";
import { useCourierSla } from "@/hooks/useCourierSla";
import type { CourierListFilters, CourierListRow } from "@/services/courierListService";
import type { WorkflowCategory } from "@/types/courier";
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
  slaColumn,
  recipientColumn,
  stateColumn,
  subjectColumn,
  tagsColumn,
} from "@/components/courier/courierListColumns";

type StateTone = Parameters<typeof stateColumn>[1];

/** Colonne « entré le » : dernier passage dans un état de la catégorie. */
interface EnteredAtColumn {
  id: string;
  title: string;
  exportLabel: string;
  groupLabel: string;
}

export interface CourierCategoryListConfig {
  /** Catégorie d'états du workflow listée (en instruction, traités, archivés). */
  category: Extract<WorkflowCategory, "processing" | "processed" | "archived">;
  icon: ReactNode;
  title: string;
  /** Préfixe des clés de cache et nom du fichier CSV. */
  key: string;
  csvName: string;
  stateTone: StateTone;
  /** Délais de traitement : utiles tant que le courrier n'est pas archivé. */
  withSla: boolean;
  enteredAt?: EnteredAtColumn;
  empty: string;
  emptyFiltered: string;
}

/**
 * Liste des courriers reçus dont l'état appartient à une catégorie du
 * workflow. Tout est filtré en SQL (`search_couriers` via `useCourierList`) :
 * service, état, tag, période et mots-clés.
 */
export function CourierCategoryList({ config }: { config: CourierCategoryListConfig }) {
  const { organizationId } = useOrganization();
  const navigate = useNavigate();

  const { data: categoryStates } = useQuery({
    queryKey: [`${config.category}-states`, organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("workflow_states")
        .select("id, name, workflow_id")
        .eq("organization_id", organizationId!)
        .eq("category", config.category);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!organizationId,
  });

  const stateById = useMemo(() => {
    const m = new Map<string, { id: string; name: string }>();
    (categoryStates ?? []).forEach((s) => m.set(s.id, { id: s.id, name: s.name }));
    return m;
  }, [categoryStates]);

  const stateIds = useMemo(() => (categoryStates ?? []).map((s) => s.id), [categoryStates]);

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

  const facets = useCourierFacets({ services, states: categoryStates, tags, withPeriod: true });
  const userServiceFilter = useUserServiceFilter();

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
      keywords: facets.keywords || null,
      prefixMatch: true,
      visibleSocleOrganizationIds: userServiceFilter,
    };
  }, [organizationId, stateIds, facets.stateIds, facets.serviceId, facets.tagNames, facets.dateFrom, facets.keywords, userServiceFilter]);

  // updated_at : les dossiers qui viennent de bouger d'abord. À ne pas
  // confondre avec la colonne « entré le », calculée par une seconde requête
  // sur la seule page affichée et donc intriable côté serveur.
  const list = useCourierList(filters, {
    queryKeyPrefix: `${config.key}-couriers`,
    defaultSort: { key: "updated_at", dir: "desc" },
  });

  // Date d'entrée dans la catégorie : dernier passage dans l'un de ses états.
  // Ne porte que sur la page affichée.
  const courierIds = useMemo(() => list.rows.map((c) => c.id), [list.rows]);
  const { data: enteredAtMap } = useQuery({
    queryKey: [`${config.key}-entered-at`, organizationId, courierIds, stateIds],
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
    enabled: !!config.enteredAt && !!organizationId && courierIds.length > 0 && stateIds.length > 0,
  });

  const slaOf = useCourierSla(organizationId);

  const [tableInstance, onTableInstanceChange] = useDataTableInstance<CourierListRow>();
  const { exportCsv, isExporting } = useCourierCsvExport(list.filters, tableInstance, config.csvName);

  const columns = useMemo<ColumnDef<CourierListRow>[]>(
    () => [
      subjectColumn("sender"),
      stateColumn(stateById, config.stateTone),
      ...(config.withSla ? [slaColumn(slaOf)] : []),
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
      // chargée à part pour les seuls courriers de la page affichée.
      ...(config.enteredAt
        ? [dateColumn({ ...config.enteredAt, value: (c: CourierListRow) => enteredAtMap?.[c.id] })]
        : []),
    ],
    [stateById, tagByName, enteredAtMap, slaOf, config],
  );

  return (
    <ListPage>
      <ListToolbar
        icon={config.icon}
        title={config.title}
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
          emptyMessage={facets.activeCount ? config.emptyFiltered : config.empty}
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
