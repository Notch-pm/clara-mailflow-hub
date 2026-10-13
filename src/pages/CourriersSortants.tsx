import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import { Send, Plus } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useOrganization } from "@/contexts/OrganizationContext";
import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnToggle } from "@/components/data-table/data-table-column-toggle";
import { DataTableGroupingMenu } from "@/components/data-table/data-table-grouping-menu";
import { useDataTableInstance } from "@/components/data-table/use-data-table-instance";
import { ListActiveFilters, ListFilterButton } from "@/components/list/ListFilters";
import {
  ListDensityToggle,
  ListExportButton,
  ListMessage,
  ListPage,
  ListToolbar,
  ToolbarButton,
  ToolbarTooltip,
} from "@/components/list/ListPage";
import { CourierFacetFields } from "@/components/courier/CourierFacetFields";
import {
  channelColumn,
  chronoColumn,
  dateColumn,
  organisationColumn,
  subjectColumn,
} from "@/components/courier/courierListColumns";
import { NewOutboundDialog } from "@/components/courier/outbound/NewOutboundDialog";
import { listOutboundKinds } from "@/services/outboundCourierService";
import { listOrgsWithConfig } from "@/services/socleOrgConfigService";
import type { CourierListFilters, CourierListRow } from "@/services/courierListService";
import { useUserServiceFilter } from "@/hooks/useUserServiceFilter";
import { useCourierList } from "@/hooks/useCourierList";
import { useCourierFacets } from "@/hooks/useCourierFacets";
import { useCourierCsvExport } from "@/hooks/useCourierCsvExport";

export default function CourriersSortants() {
  const { organizationId } = useOrganization();
  const navigate = useNavigate();
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: services } = useQuery({
    queryKey: ["socle-orgs-config", organizationId],
    queryFn: () => listOrgsWithConfig(organizationId!),
    enabled: !!organizationId,
  });

  // Seul filtre que le RPC sait appliquer aux sortants : la période porte sur la
  // date de RÉCEPTION, que ces courriers n'ont pas.
  const facets = useCourierFacets({ services });
  const userServiceFilter = useUserServiceFilter();

  const filters = useMemo<CourierListFilters | null>(() => {
    if (!organizationId) return null;
    return {
      organizationId,
      direction: "outbound",
      socleOrganizationId: facets.serviceId,
      keywords: facets.keywords || null,
      prefixMatch: true,
      visibleSocleOrganizationIds: userServiceFilter,
    };
  }, [organizationId, facets.serviceId, facets.keywords, userServiceFilter]);

  // created_at et non sent_at : un courrier en préparation n'a pas encore de
  // date d'envoi, trier dessus le renverrait en fin de liste alors que c'est
  // celui sur lequel on travaille.
  const list = useCourierList(filters, {
    queryKeyPrefix: "couriers-outbound",
    defaultSort: { key: "created_at", dir: "desc" },
  });

  const [tableInstance, onTableInstanceChange] = useDataTableInstance<CourierListRow>();
  const { exportCsv, isExporting } = useCourierCsvExport(list.filters, tableInstance, "courriers-sortants");

  // Réponse ou initiative : `search_couriers` ne rend pas `parent_courier_id`,
  // on le relit pour la seule page affichée.
  const pageIds = useMemo(() => list.rows.map((r) => r.id), [list.rows]);
  const { data: kinds } = useQuery({
    queryKey: ["outbound-kinds", organizationId, pageIds],
    queryFn: () => listOutboundKinds(organizationId!, pageIds),
    enabled: !!organizationId && pageIds.length > 0,
  });
  // La table met en cache la valeur de chaque cellule tant que ses données
  // gardent la même identité : sans ces copies, la colonne « Type », calculée
  // avant l'arrivée de `kinds`, resterait vide.
  const rows = useMemo(() => list.rows.map((r) => ({ ...r })), [list.rows, kinds]);

  const columns = useMemo<ColumnDef<CourierListRow>[]>(
    () => [
      chronoColumn(),
      {
        id: "kind",
        accessorFn: (c) => (kinds?.get(c.id) === "reply" ? "Réponse" : kinds?.get(c.id) ? "Initiative" : ""),
        enableSorting: false,
        header: "Type",
        cell: ({ getValue }) => {
          const label = getValue() as string;
          if (!label) return null;
          return (
            <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-[11.5px] font-semibold text-muted-foreground">
              {label}
            </span>
          );
        },
        meta: { exportLabel: "Type", width: 110 },
      },
      subjectColumn("recipient"),
      organisationColumn(),
      channelColumn(),
      dateColumn({
        id: "sent_at",
        title: "Envoyé le",
        exportLabel: "Envoyé le",
        groupLabel: "Mois d'envoi",
        value: (c) => c.sent_at,
        sortable: true,
      }),
    ],
    [kinds],
  );

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
          services={services}
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
        count={list.filters && !list.isLoading ? list.totalCount : null}
        countLabel="courriers"
        primary={newCourier}
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
          data={rows}
          isLoading={list.isLoading}
          onRowClick={(c) => navigate(`/courrier/${c.id}`)}
          onTableInstanceChange={onTableInstanceChange}
          sorting={list.sorting}
          onSortingChange={list.onSortingChange}
          emptyMessage={
            facets.activeCount
              ? "Aucun courrier sortant ne correspond à ces critères."
              : "Aucun courrier sortant."
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
