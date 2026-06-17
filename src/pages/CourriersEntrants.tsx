import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { ColumnDef, Table as TanstackTable } from "@tanstack/react-table";
import { Download, MailOpen, Plus, Search } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { useOrganization } from "@/contexts/OrganizationContext";
import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { DataTableColumnToggle } from "@/components/data-table/data-table-column-toggle";
import { DataTableGroupingSelect } from "@/components/data-table/data-table-grouping-select";
import { buildCsv, downloadCsv, type CsvColumn } from "@/components/data-table/csv-export";
import { getCouriers, createCourier, fetchAllCouriersForExport } from "@/services/courierService";
import type { CourierChannel, CourierWithRelations } from "@/types/courier";

const createCourierSchema = z.object({
  subject: z.string().min(1, "L'objet est obligatoire").max(500),
  channel: z.enum(["paper", "email", "portal"] as const, { required_error: "Le canal est obligatoire" }),
  received_at: z.string().min(1, "La date de réception est obligatoire"),
});

type CreateCourierForm = z.infer<typeof createCourierSchema>;

const channelLabels: Record<CourierChannel, string> = {
  paper: "Papier",
  email: "Email",
  portal: "Portail",
};

export default function CourriersEntrants() {
  const { organizationId } = useOrganization();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);

  const form = useForm<CreateCourierForm>({
    resolver: zodResolver(createCourierSchema),
    defaultValues: { subject: "", channel: undefined, received_at: new Date().toISOString().slice(0, 16) },
  });

  const { data: couriers, isLoading } = useQuery({
    queryKey: ["couriers", "inbound", organizationId, search],
    queryFn: async () => {
      if (!organizationId) return [];
      const { data, error } = await getCouriers(organizationId, {
        direction: "inbound",
        search: search || undefined,
      });
      if (error) throw error;
      return (data ?? []) as unknown as CourierWithRelations[];
    },
    enabled: !!organizationId,
  });

  const [tableInstance, setTableInstance] = useState<TanstackTable<CourierWithRelations> | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const columns = useMemo<ColumnDef<CourierWithRelations>[]>(
    () => [
      {
        accessorKey: "chrono",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Chrono" />,
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.chrono ?? "—"}</span>,
        meta: { exportLabel: "Chrono" },
      },
      {
        accessorKey: "subject",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Objet" />,
        cell: ({ row }) => (
          <span className="font-medium max-w-[300px] truncate block">{row.original.subject ?? "Sans objet"}</span>
        ),
        meta: { exportLabel: "Objet" },
      },
      {
        id: "channel",
        accessorFn: (c) => channelLabels[c.channel as CourierChannel] ?? c.channel,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Canal" />,
        cell: ({ row }) => (
          <Badge variant="outline">{channelLabels[row.original.channel as CourierChannel] ?? row.original.channel}</Badge>
        ),
        meta: { exportLabel: "Canal" },
      },
      {
        accessorKey: "assigned_service",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Service" />,
        cell: ({ row }) => <span className="text-sm">{row.original.assigned_service ?? "—"}</span>,
        meta: { exportLabel: "Service" },
      },
      {
        id: "received_at",
        accessorFn: (c) => (c.received_at ? new Date(c.received_at).toLocaleDateString("fr-FR") : ""),
        header: ({ column }) => <DataTableColumnHeader column={column} title="Reçu le" />,
        cell: ({ row }) => (
          <span className="text-sm">{row.original.received_at ? new Date(row.original.received_at).toLocaleDateString("fr-FR") : "—"}</span>
        ),
        meta: { exportLabel: "Reçu le" },
      },
    ],
    [],
  );

  async function handleExportCsv() {
    if (!organizationId || !tableInstance) return;
    setIsExporting(true);
    try {
      const allRows = await fetchAllCouriersForExport(organizationId, { direction: "inbound", search: search || undefined });
      const csvColumns: CsvColumn<CourierWithRelations>[] = tableInstance
        .getVisibleLeafColumns()
        .map((col) => ({
          header: (col.columnDef.meta as { exportLabel?: string } | undefined)?.exportLabel ?? col.id,
          accessor: (row) => (col.accessorFn as ((row: CourierWithRelations) => unknown) | undefined)?.(row) ?? "",
        }));
      const csv = buildCsv(allRows, csvColumns);
      downloadCsv(csv, `courriers-entrants-${new Date().toISOString().slice(0, 10)}.csv`);
    } catch (e) {
      console.error(e);
      toast.error("Erreur lors de l'export du fichier.");
    } finally {
      setIsExporting(false);
    }
  }

  const createMutation = useMutation({
    mutationFn: async (values: CreateCourierForm) => {
      if (!organizationId) throw new Error("Organisation non sélectionnée");
      const { error } = await createCourier({
        organization_id: organizationId,
        direction: "inbound",
        channel: values.channel,
        subject: values.subject,
        received_at: values.received_at,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["couriers"] });
      toast.success("Courrier créé avec succès");
      form.reset();
      setDialogOpen(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <MailOpen className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Courriers entrants</h1>
            <p className="text-muted-foreground">Gestion et suivi des courriers reçus</p>
          </div>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button className="gap-1.5">
              <Plus className="h-4 w-4" /> Nouveau courrier
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Créer un courrier entrant</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit((v) => createMutation.mutate(v))} className="space-y-4">
                <FormField control={form.control} name="subject" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Objet</FormLabel>
                    <FormControl><Input placeholder="Objet du courrier" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="channel" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Canal</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger><SelectValue placeholder="Sélectionner un canal" /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="paper">Papier</SelectItem>
                        <SelectItem value="email">Email</SelectItem>
                        <SelectItem value="portal">Portail</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="received_at" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date de réception</FormLabel>
                    <FormControl><Input type="datetime-local" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <Button type="submit" className="w-full" disabled={createMutation.isPending}>
                  {createMutation.isPending ? "Création..." : "Créer le courrier"}
                </Button>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      {organizationId && (
        <div className="flex items-center justify-end gap-2">
          {tableInstance && <DataTableGroupingSelect table={tableInstance} />}
          {tableInstance && <DataTableColumnToggle table={tableInstance} />}
          <Button variant="outline" size="sm" onClick={handleExportCsv} disabled={isExporting || !couriers?.length}>
            <Download className="h-4 w-4 mr-1" />
            {isExporting ? "Export…" : "Exporter CSV"}
          </Button>
        </div>
      )}

      <Card>
        <CardContent className="pt-6">
          <div className="flex items-end gap-4 flex-wrap">
            <div className="flex flex-col gap-1.5 flex-1 min-w-[200px] max-w-sm">
              <Label className="text-xs text-muted-foreground">Recherche</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Rechercher par objet…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {!organizationId ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Veuillez sélectionner une organisation pour voir les courriers.
          </CardContent>
        </Card>
      ) : (
        <DataTable
          columns={columns}
          data={couriers ?? []}
          isLoading={isLoading}
          onRowClick={(c) => navigate(`/courrier/${c.id}`)}
          onTableInstanceChange={setTableInstance}
          emptyMessage='Aucun courrier entrant. Cliquez sur "Nouveau courrier" pour commencer.'
        />
      )}
    </div>
  );
}
