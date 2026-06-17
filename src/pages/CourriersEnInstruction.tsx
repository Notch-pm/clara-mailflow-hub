import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef, Table as TanstackTable } from "@tanstack/react-table";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Download, Search, FileClock } from "lucide-react";
import { useOrganization } from "@/contexts/OrganizationContext";
import { supabase } from "@/integrations/supabase/client";
import { listTags } from "@/services/courierTagService";
import { listServices } from "@/services/orgServiceService";
import { useUserServiceFilter, applyServiceFilter } from "@/hooks/useUserServiceFilter";
import { fetchAllCouriersByStatesForExport } from "@/services/courierService";
import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { DataTableColumnToggle } from "@/components/data-table/data-table-column-toggle";
import { DataTableGroupingSelect } from "@/components/data-table/data-table-grouping-select";
import { buildCsv, downloadCsv, type CsvColumn } from "@/components/data-table/csv-export";

import { readableTextColor } from "@/lib/tag-color";
import { toast } from "sonner";
import type { CourierWithRelations } from "@/types/courier";

export default function CourriersEnInstruction() {
  const { organizationId } = useOrganization();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [serviceFilter, setServiceFilter] = useState<string>("all");
  const [tagFilter, setTagFilter] = useState<string>("all");
  const [stateFilter, setStateFilter] = useState<string>("all");

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
    queryKey: ["org-services", organizationId],
    queryFn: () => listServices(organizationId!),
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

  const { data: couriers, isLoading } = useQuery({
    queryKey: ["instruction-couriers", organizationId, stateIds, search],
    queryFn: async () => {
      if (!organizationId || !stateIds.length) return [];
      let q = supabase
        .from("couriers")
        .select("id, subject, direction, channel, received_at, sent_at, workflow_state_id, assigned_service, metadata, chrono, created_at, updated_at, courier_participants(id, role, name, email, usager_id)")
        .eq("organization_id", organizationId)
        .eq("direction", "inbound")
        .in("workflow_state_id", stateIds)
        .order("updated_at", { ascending: false })
        .limit(200);
      if (search) q = q.ilike("subject", `%${search}%`);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as CourierWithRelations[];
    },
    enabled: !!organizationId && !!stateIds.length,
  });

  const userServiceFilter = useUserServiceFilter();

  const applyFilters = useCallback(
    (list: CourierWithRelations[]): CourierWithRelations[] => {
      let out = applyServiceFilter(list, userServiceFilter);
      if (serviceFilter !== "all") {
        const svc = services?.find((s) => s.id === serviceFilter);
        if (svc) out = out.filter((c) => c.assigned_service === svc.name);
      }
      if (stateFilter !== "all") {
        out = out.filter((c) => c.workflow_state_id === stateFilter);
      }
      if (tagFilter !== "all") {
        out = out.filter((c) => {
          const t = (c.metadata as { tags?: string[] } | null)?.tags ?? [];
          return Array.isArray(t) && t.some((x: string) => x.toLowerCase() === tagFilter.toLowerCase());
        });
      }
      return out;
    },
    [userServiceFilter, serviceFilter, stateFilter, tagFilter, services],
  );

  const filtered = useMemo(() => applyFilters(couriers ?? []), [couriers, applyFilters]);

  function getSender(c: CourierWithRelations): string {
    const p = c.courier_participants?.find((x) => x.role === "sender");
    if (!p) return "—";
    const full = [p.first_name, p.last_name].filter(Boolean).join(" ");
    return full || p.name || p.email || "—";
  }

  function getRecipient(c: CourierWithRelations): string {
    const p = c.courier_participants?.find((x) => x.role === "recipient");
    return p?.name ?? p?.email ?? "—";
  }

  function getTags(c: CourierWithRelations): string[] {
    const t = (c.metadata as { tags?: string[] } | null)?.tags ?? [];
    return Array.isArray(t) ? t : [];
  }

  const [tableInstance, setTableInstance] = useState<TanstackTable<CourierWithRelations> | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const columns = useMemo<ColumnDef<CourierWithRelations>[]>(
    () => [
      {
        id: "received_at",
        accessorFn: (c) => (c.received_at ? new Date(c.received_at).toLocaleDateString("fr-FR") : ""),
        header: ({ column }) => <DataTableColumnHeader column={column} title="Date de réception" />,
        cell: ({ row }) => (
          <span className="text-sm whitespace-nowrap">
            {row.original.received_at ? new Date(row.original.received_at).toLocaleDateString("fr-FR") : "—"}
          </span>
        ),
        meta: { exportLabel: "Date de réception" },
      },
      {
        accessorKey: "subject",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Objet" />,
        cell: ({ row }) => (
          <span className="text-sm font-medium max-w-[260px] truncate block">{row.original.subject ?? "Sans titre"}</span>
        ),
        meta: { exportLabel: "Objet" },
      },
      {
        id: "state",
        accessorFn: (c) => stateById.get(c.workflow_state_id ?? "")?.name ?? "",
        header: ({ column }) => <DataTableColumnHeader column={column} title="État" />,
        cell: ({ row }) => {
          const name = stateById.get(row.original.workflow_state_id ?? "")?.name;
          return name ? <Badge variant="outline" className="text-xs">{name}</Badge> : null;
        },
        meta: { exportLabel: "État" },
      },
      {
        accessorKey: "assigned_service",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Service" />,
        cell: ({ row }) => <span className="text-sm">{row.original.assigned_service ?? "—"}</span>,
        meta: { exportLabel: "Service" },
      },
      {
        id: "sender",
        accessorFn: getSender,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Expéditeur" />,
        cell: ({ row }) => <span className="text-sm">{getSender(row.original)}</span>,
        meta: { exportLabel: "Expéditeur" },
      },
      {
        id: "recipient",
        accessorFn: getRecipient,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Destinataire" />,
        cell: ({ row }) => <span className="text-sm">{getRecipient(row.original)}</span>,
        meta: { exportLabel: "Destinataire" },
      },
      {
        id: "tags",
        accessorFn: (c) => getTags(c).join(", "),
        header: ({ column }) => <DataTableColumnHeader column={column} title="Tags" />,
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            {getTags(row.original).map((t) => {
              const color = tagByName.get(t.toLowerCase())?.color ?? null;
              return (
                <span
                  key={t}
                  className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
                  style={color ? { backgroundColor: color, color: readableTextColor(color) } : undefined}
                >
                  {t}
                </span>
              );
            })}
          </div>
        ),
        meta: { exportLabel: "Tags" },
      },
    ],
    [stateById, tagByName],
  );

  async function handleExportCsv() {
    if (!organizationId || !tableInstance) return;
    setIsExporting(true);
    try {
      const allRows = applyFilters(
        await fetchAllCouriersByStatesForExport(organizationId, { stateIds, search: search || undefined }),
      );
      const csvColumns: CsvColumn<CourierWithRelations>[] = tableInstance
        .getVisibleLeafColumns()
        .map((col) => ({
          header: (col.columnDef.meta as { exportLabel?: string } | undefined)?.exportLabel ?? col.id,
          accessor: (row) => (col.accessorFn as ((row: CourierWithRelations) => unknown) | undefined)?.(row) ?? "",
        }));
      const csv = buildCsv(allRows, csvColumns);
      downloadCsv(csv, `courriers-en-instruction-${new Date().toISOString().slice(0, 10)}.csv`);
    } catch (e) {
      console.error(e);
      toast.error("Erreur lors de l'export du fichier.");
    } finally {
      setIsExporting(false);
    }
  }

  function handleRowClick(c: CourierWithRelations) {
    navigate(`/courrier/${c.id}`);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <FileClock className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Courriers en instruction</h1>
          <p className="text-muted-foreground">
            Tous les courriers actuellement en cours de traitement.
          </p>
        </div>
      </div>

      {organizationId && (
        <div className="flex items-center justify-end gap-2">
          {tableInstance && <DataTableGroupingSelect table={tableInstance} />}
          {tableInstance && <DataTableColumnToggle table={tableInstance} />}
          <Button variant="outline" size="sm" onClick={handleExportCsv} disabled={isExporting || !filtered.length}>
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

            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground whitespace-nowrap">Service</Label>
              <Select value={serviceFilter} onValueChange={setServiceFilter}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Service" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous les services</SelectItem>
                  {(services ?? []).map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground whitespace-nowrap">État</Label>
              <Select value={stateFilter} onValueChange={setStateFilter}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="État" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous les états</SelectItem>
                  {(processingStates ?? []).map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground whitespace-nowrap">Tag</Label>
              <Select value={tagFilter} onValueChange={setTagFilter}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue placeholder="Tag" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous les tags</SelectItem>
                  {(tags ?? []).map((t) => (
                    <SelectItem key={t.id} value={t.name}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {!organizationId ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Veuillez sélectionner une organisation.
          </CardContent>
        </Card>
      ) : (
        <DataTable
          columns={columns}
          data={filtered}
          isLoading={isLoading}
          onRowClick={handleRowClick}
          onTableInstanceChange={setTableInstance}
          emptyMessage="Aucun courrier en cours d'instruction."
        />
      )}
    </div>
  );
}
