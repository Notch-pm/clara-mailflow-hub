import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import { Send, Plus } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
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
  ListSearch,
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
import { createCourier } from "@/services/courierService";
import { listOrgsWithConfig } from "@/services/socleOrgConfigService";
import type { CourierListFilters, CourierListRow } from "@/services/courierListService";
import { useUserServiceFilter } from "@/hooks/useUserServiceFilter";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useCourierList } from "@/hooks/useCourierList";
import { useCourierFacets } from "@/hooks/useCourierFacets";
import { useCourierCsvExport } from "@/hooks/useCourierCsvExport";

const schema = z.object({
  subject: z.string().min(1, "L'objet est obligatoire").max(500),
  channel: z.enum(["paper", "email", "portal"] as const, { required_error: "Le canal est obligatoire" }),
  sent_at: z.string().min(1, "La date d'envoi est obligatoire"),
});

export default function CourriersSortants() {
  const { organizationId } = useOrganization();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { subject: "", channel: undefined, sent_at: new Date().toISOString().slice(0, 16) },
  });

  const { data: services } = useQuery({
    queryKey: ["socle-orgs-config", organizationId],
    queryFn: () => listOrgsWithConfig(organizationId!),
    enabled: !!organizationId,
  });

  // Seul filtre que le RPC sait appliquer aux sortants : la période porte sur la
  // date de RÉCEPTION, que ces courriers n'ont pas.
  const facets = useCourierFacets({ services });
  const userServiceFilter = useUserServiceFilter();

  const debouncedSearch = useDebouncedValue(search, 300);

  const filters = useMemo<CourierListFilters | null>(() => {
    if (!organizationId) return null;
    return {
      organizationId,
      direction: "outbound",
      socleOrganizationId: facets.serviceId,
      keywords: debouncedSearch || null,
      prefixMatch: true,
      visibleSocleOrganizationIds: userServiceFilter,
    };
  }, [organizationId, facets.serviceId, debouncedSearch, userServiceFilter]);

  // created_at et non sent_at : un courrier en préparation n'a pas encore de
  // date d'envoi, trier dessus le renverrait en fin de liste alors que c'est
  // celui sur lequel on travaille.
  const list = useCourierList(filters, {
    queryKeyPrefix: "couriers-outbound",
    defaultSort: { key: "created_at", dir: "desc" },
  });

  const [tableInstance, onTableInstanceChange] = useDataTableInstance<CourierListRow>();
  const { exportCsv, isExporting } = useCourierCsvExport(list.filters, tableInstance, "courriers-sortants");

  const columns = useMemo<ColumnDef<CourierListRow>[]>(
    () => [
      chronoColumn(),
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
    [],
  );

  const createMutation = useMutation({
    mutationFn: async (values: z.infer<typeof schema>) => {
      if (!organizationId) throw new Error("Organisation non sélectionnée");
      const { error } = await createCourier({
        organization_id: organizationId,
        direction: "outbound",
        channel: values.channel,
        subject: values.subject,
        sent_at: values.sent_at,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["couriers-outbound"] });
      toast.success("Courrier sortant créé");
      form.reset();
      setDialogOpen(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const newCourier = (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <ToolbarTooltip label="Nouveau courrier" hideFromXl>
        <DialogTrigger asChild>
          <ToolbarButton primary icon={<Plus />} label="Nouveau courrier" text="Nouveau" showLabel />
        </DialogTrigger>
      </ToolbarTooltip>
      <DialogContent>
        <DialogHeader><DialogTitle>Créer un courrier sortant</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => createMutation.mutate(v))} className="space-y-4">
            <FormField control={form.control} name="subject" render={({ field }) => (
              <FormItem><FormLabel>Objet</FormLabel><FormControl><Input placeholder="Objet du courrier" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="channel" render={({ field }) => (
              <FormItem><FormLabel>Canal</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl><SelectTrigger><SelectValue placeholder="Sélectionner un canal" /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value="paper">Papier</SelectItem>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="portal">Portail</SelectItem>
                  </SelectContent>
                </Select><FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="sent_at" render={({ field }) => (
              <FormItem><FormLabel>Date d'envoi</FormLabel><FormControl><Input type="datetime-local" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <Button type="submit" className="w-full" disabled={createMutation.isPending}>
              {createMutation.isPending ? "Création..." : "Créer le courrier"}
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );

  return (
    <ListPage>
      <ListToolbar
        icon={<Send className="text-warning" />}
        title="Courriers sortants"
        count={list.filters && !list.isLoading ? list.totalCount : null}
        countLabel="courriers"
        search={<ListSearch value={search} onChange={setSearch} placeholder="Rechercher par objet…" />}
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
          data={list.rows}
          isLoading={list.isLoading}
          onRowClick={(c) => navigate(`/courrier/${c.id}`)}
          onTableInstanceChange={onTableInstanceChange}
          sorting={list.sorting}
          onSortingChange={list.onSortingChange}
          emptyMessage={
            facets.activeCount || debouncedSearch
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
