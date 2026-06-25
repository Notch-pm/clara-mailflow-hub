import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Loader2, ExternalLink } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { updateCourier } from "@/services/courierService";
import { logEvent } from "@/services/courierEventService";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  /** IDs of the couriers linked to the one that was just closed. */
  linkedCourierIds: string[];
  /** Title/chrono of the source courier, used in the dialog copy. */
  sourceTitle: string;
}

interface LinkedCourierRow {
  id: string;
  subject: string | null;
  chrono: string | null;
  workflow_state_id: string | null;
  assigned_service: string | null;
  state: { id: string; name: string; is_final: boolean; category: string } | null;
  workflowId: string | null;
  finalState: { id: string; name: string; category: string } | null;
}

export default function CloseLinkedCouriersDialog({
  open,
  onOpenChange,
  organizationId,
  linkedCourierIds,
  sourceTitle,
}: Props) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["close-linked-couriers", linkedCourierIds.sort().join(",")],
    enabled: open && linkedCourierIds.length > 0,
    queryFn: async (): Promise<LinkedCourierRow[]> => {
      const { data: couriers, error } = await supabase
        .from("couriers")
        .select("id, subject, chrono, workflow_state_id, assigned_service")
        .in("id", linkedCourierIds);
      if (error) throw error;

      const stateIds = Array.from(
        new Set((couriers ?? []).map((c) => c.workflow_state_id).filter(Boolean)),
      ) as string[];
      const { data: states } = stateIds.length
        ? await supabase
            .from("workflow_states")
            .select("id, name, is_final, category, workflow_id")
            .in("id", stateIds)
        : { data: [] as any[] };
      const stateById = new Map<string, any>((states ?? []).map((s) => [s.id, s]));

      const serviceNames = Array.from(
        new Set((couriers ?? []).map((c) => c.assigned_service).filter(Boolean)),
      ) as string[];
      const { data: servicesRows } = serviceNames.length
        ? await supabase
            .from("services")
            .select("name, workflow_id")
            .eq("organization_id", organizationId)
            .in("name", serviceNames)
        : { data: [] as any[] };
      const workflowByService = new Map<string, string | null>(
        (servicesRows ?? []).map((s: any) => [s.name.toLowerCase(), s.workflow_id]),
      );

      const workflowIds = Array.from(
        new Set([
          ...((states ?? []).map((s: any) => s.workflow_id).filter(Boolean) as string[]),
          ...((servicesRows ?? []).map((s: any) => s.workflow_id).filter(Boolean) as string[]),
        ]),
      );
      const { data: allStates } = workflowIds.length
        ? await supabase
            .from("workflow_states")
            .select("id, name, is_final, category, workflow_id")
            .in("workflow_id", workflowIds)
        : { data: [] as any[] };
      const finalByWorkflow = new Map<string, any>();
      for (const s of (allStates ?? []) as any[]) {
        if (!s.is_final) continue;
        const current = finalByWorkflow.get(s.workflow_id);
        // Prefer "processed" category over others.
        if (!current || (s.category === "processed" && current.category !== "processed")) {
          finalByWorkflow.set(s.workflow_id, s);
        }
      }

      return (couriers ?? []).map((c) => {
        const state = c.workflow_state_id ? stateById.get(c.workflow_state_id) ?? null : null;
        const workflowId =
          state?.workflow_id ??
          (c.assigned_service ? workflowByService.get(c.assigned_service.toLowerCase()) ?? null : null);
        const finalState = workflowId ? finalByWorkflow.get(workflowId) ?? null : null;
        return {
          id: c.id,
          subject: c.subject,
          chrono: c.chrono,
          workflow_state_id: c.workflow_state_id,
          assigned_service: c.assigned_service,
          state: state
            ? { id: state.id, name: state.name, is_final: state.is_final, category: state.category }
            : null,
          workflowId,
          finalState: finalState
            ? { id: finalState.id, name: finalState.name, category: finalState.category }
            : null,
        };
      });
    },
  });

  // Couriers that can be closed: not already final AND we resolved a target final state.
  const closable = useMemo(
    () => rows.filter((r) => r.state?.is_final !== true && r.finalState),
    [rows],
  );

  // Default-select all closable rows when the dialog opens / data loads.
  useEffect(() => {
    if (!open) return;
    setSelected((prev) => {
      const next: Record<string, boolean> = {};
      for (const r of closable) next[r.id] = prev[r.id] ?? true;
      return next;
    });
  }, [open, closable]);

  const selectedIds = closable.filter((r) => selected[r.id]).map((r) => r.id);

  const closeMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const targets = closable.filter((r) => ids.includes(r.id));
      const results: { id: string; ok: boolean; error?: string }[] = [];
      for (const r of targets) {
        if (!r.finalState) {
          results.push({ id: r.id, ok: false, error: "État final introuvable" });
          continue;
        }
        try {
          const { error } = await updateCourier(organizationId, r.id, {
            workflow_state_id: r.finalState.id,
          });
          if (error) throw error;
          await logEvent(organizationId, r.id, "state_changed", {
            from_id: r.state?.id ?? null,
            from_name: r.state?.name ?? null,
            to_id: r.finalState.id,
            to_name: r.finalState.name,
            via: "linked_close",
          });
          results.push({ id: r.id, ok: true });
        } catch (e: any) {
          results.push({ id: r.id, ok: false, error: e?.message ?? "Erreur" });
        }
      }
      return results;
    },
    onSuccess: (results) => {
      const okCount = results.filter((r) => r.ok).length;
      const koCount = results.length - okCount;
      if (okCount > 0) toast.success(`${okCount} courrier(s) clos`);
      if (koCount > 0) toast.error(`${koCount} courrier(s) n'ont pas pu être clos`);
      queryClient.invalidateQueries({ queryKey: ["mailbox-couriers"] });
      queryClient.invalidateQueries({ queryKey: ["mailbox-unassigned"] });
      queryClient.invalidateQueries({ queryKey: ["instruction-couriers"] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const allSelected = closable.length > 0 && selectedIds.length === closable.length;
  const toggleAll = () => {
    if (allSelected) setSelected({});
    else setSelected(Object.fromEntries(closable.map((r) => [r.id, true])));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Fermer les courriers liés ?</DialogTitle>
          <DialogDescription>
            Vous venez de clore <strong>{sourceTitle}</strong>. Souhaitez-vous également
            clore les courriers liés ci-dessous ?
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : closable.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            Aucun courrier lié à clore (ils sont déjà clos ou aucun état final n'est
            configuré).
          </p>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={allSelected} onCheckedChange={toggleAll} />
                <span>Tout sélectionner ({closable.length})</span>
              </label>
              <span className="text-xs text-muted-foreground">
                {selectedIds.length} sélectionné(s)
              </span>
            </div>
            <ul className="max-h-80 overflow-y-auto space-y-2 rounded-md border p-2">
              {closable.map((r) => (
                <li
                  key={r.id}
                  className="flex items-start gap-3 rounded-md p-2 hover:bg-muted/50"
                >
                  <Checkbox
                    checked={selected[r.id] ?? false}
                    onCheckedChange={(v) =>
                      setSelected((prev) => ({ ...prev, [r.id]: v === true }))
                    }
                    className="mt-1"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {r.chrono && (
                        <Badge variant="outline" className="text-xs">
                          {r.chrono}
                        </Badge>
                      )}
                      <span className="text-sm font-medium line-clamp-2 break-words">
                        {r.subject ?? "Sans objet"}
                      </span>
                      <Link
                        to={`/courrier/${r.id}`}
                        target="_blank"
                        className="text-muted-foreground hover:text-foreground"
                        title="Ouvrir dans un nouvel onglet"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Link>
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                      {r.state?.name && <span>État : {r.state.name}</span>}
                      {r.finalState?.name && <span>→ {r.finalState.name}</span>}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={closeMutation.isPending}
                    onClick={() => closeMutation.mutate([r.id])}
                  >
                    Clore
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Plus tard
          </Button>
          <Button
            disabled={selectedIds.length === 0 || closeMutation.isPending}
            onClick={() => closeMutation.mutate(selectedIds)}
          >
            {closeMutation.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Clore la sélection ({selectedIds.length})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
