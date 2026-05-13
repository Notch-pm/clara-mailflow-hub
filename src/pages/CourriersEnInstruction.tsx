import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, FileClock, ChevronDown, ChevronRight } from "lucide-react";
import { useOrganization } from "@/contexts/OrganizationContext";
import { supabase } from "@/integrations/supabase/client";
import { listTags } from "@/services/courierTagService";
import { listServices } from "@/services/orgServiceService";

import { readableTextColor } from "@/lib/tag-color";
import { cn } from "@/lib/utils";
import type { CourierWithRelations } from "@/types/courier";

type GroupBy = "none" | "state" | "service";

export default function CourriersEnInstruction() {
  const { organizationId } = useOrganization();
  const [search, setSearch] = useState("");
  const [serviceFilter, setServiceFilter] = useState<string>("all");
  const [tagFilter, setTagFilter] = useState<string>("all");
  const [stateFilter, setStateFilter] = useState<string>("all");
  const [groupBy, setGroupBy] = useState<GroupBy>("none");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [selectedCourier, setSelectedCourier] = useState<CourierWithRelations | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

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
        .select("*, courier_participants(*)")
        .eq("organization_id", organizationId)
        .eq("direction", "inbound")
        .in("workflow_state_id", stateIds)
        .order("updated_at", { ascending: false });
      if (search) q = q.ilike("subject", `%${search}%`);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!organizationId && !!stateIds.length,
  });

  const filtered = useMemo(() => {
    let list = couriers ?? [];
    if (serviceFilter !== "all") {
      const svc = services?.find((s) => s.id === serviceFilter);
      if (svc) list = list.filter((c) => c.assigned_service === svc.name);
    }
    if (stateFilter !== "all") {
      list = list.filter((c) => c.workflow_state_id === stateFilter);
    }
    if (tagFilter !== "all") {
      list = list.filter((c) => {
        const t = (c.metadata as { tags?: string[] } | null)?.tags ?? [];
        return Array.isArray(t) && t.some((x: string) => x.toLowerCase() === tagFilter.toLowerCase());
      });
    }
    return list;
  }, [couriers, serviceFilter, stateFilter, tagFilter, services]);

  // Group
  const groups = useMemo(() => {
    if (groupBy === "none") {
      return [{ key: "all", label: "", items: filtered }];
    }
    const map = new Map<string, { label: string; items: typeof filtered }>();
    filtered.forEach((c) => {
      let key: string;
      let label: string;
      if (groupBy === "state") {
        key = c.workflow_state_id ?? "—";
        label = stateById.get(c.workflow_state_id ?? "")?.name ?? "Sans état";
      } else {
        key = c.assigned_service ?? "—";
        label = c.assigned_service ?? "Sans service";
      }
      if (!map.has(key)) map.set(key, { label, items: [] });
      map.get(key)!.items.push(c);
    });
    return Array.from(map.entries())
      .map(([key, v]) => ({ key, ...v }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [filtered, groupBy, stateById]);

  function toggle(key: string) {
    setCollapsed((c) => ({ ...c, [key]: !c[key] }));
  }

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

  function handleRowClick(c: CourierWithRelations) {
    setSelectedCourier(c);
    setPanelOpen(true);
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

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Rechercher par objet…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

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

        <div className="ml-auto flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Grouper par</span>
          <Select value={groupBy} onValueChange={(v) => setGroupBy(v as GroupBy)}>
            <SelectTrigger className="w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Aucun</SelectItem>
              <SelectItem value="state">État</SelectItem>
              <SelectItem value="service">Service</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Content */}
      {!organizationId ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Veuillez sélectionner une organisation.
          </CardContent>
        </Card>
      ) : isLoading ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">Chargement…</CardContent>
        </Card>
      ) : !filtered.length ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Aucun courrier en cours d'instruction.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => {
            const isCollapsed = collapsed[g.key];
            return (
              <Card key={g.key}>
                {groupBy !== "none" && (
                  <button
                    type="button"
                    onClick={() => toggle(g.key)}
                    className="w-full flex items-center gap-2 px-4 py-3 border-b hover:bg-muted/50 transition-colors text-left"
                  >
                    {isCollapsed ? (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    )}
                    <span className="font-medium text-sm">{g.label}</span>
                    <Badge variant="secondary" className="ml-1">
                      {g.items.length}
                    </Badge>
                  </button>
                )}
                {!isCollapsed && (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date de réception</TableHead>
                        <TableHead>Objet</TableHead>
                        <TableHead>État</TableHead>
                        <TableHead>Service</TableHead>
                        <TableHead>Expéditeur</TableHead>
                        <TableHead>Destinataire</TableHead>
                        <TableHead>Tags</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {g.items.map((c) => {
                        const courierTags = (c.metadata as { tags?: string[] } | null)?.tags ?? [];
                        const stateName = stateById.get(c.workflow_state_id ?? "")?.name;
                        return (
                          <TableRow
                            key={c.id}
                            className="cursor-pointer hover:bg-muted/50"
                            onClick={() => handleRowClick(c)}
                          >
                            <TableCell className="text-sm whitespace-nowrap">
                              {c.received_at
                                ? new Date(c.received_at).toLocaleDateString("fr-FR")
                                : "—"}
                            </TableCell>
                            <TableCell className="text-sm font-medium max-w-[260px] truncate">
                              {c.subject ?? "Sans titre"}
                            </TableCell>
                            <TableCell>
                              {stateName && (
                                <Badge variant="outline" className="text-xs">
                                  {stateName}
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-sm">{c.assigned_service ?? "—"}</TableCell>
                            <TableCell className="text-sm">{getSender(c)}</TableCell>
                            <TableCell className="text-sm">{getRecipient(c)}</TableCell>
                            <TableCell>
                              <div className="flex flex-wrap gap-1">
                                {courierTags.map((t) => {
                                  const color = tagByName.get(t.toLowerCase())?.color ?? null;
                                  return (
                                    <span
                                      key={t}
                                      className={cn(
                                        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium",
                                        !color && "bg-muted text-foreground",
                                      )}
                                      style={
                                        color
                                          ? { backgroundColor: color, color: readableTextColor(color) }
                                          : undefined
                                      }
                                    >
                                      {t}
                                    </span>
                                  );
                                })}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {organizationId && (
        <MailboxSidePanel
          courier={selectedCourier}
          open={panelOpen}
          onOpenChange={setPanelOpen}
          organizationId={organizationId}
          withTabs
        />
      )}
    </div>
  );
}
