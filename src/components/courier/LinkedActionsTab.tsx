import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2, Pencil, Ticket as TicketIcon, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  listTicketsForCourier,
  deleteTicket,
  type ActionTicketWithProcedure,
} from "@/services/actionTicketService";
import { logEvent } from "@/services/courierEventService";
import { supabase } from "@/integrations/supabase/client";
import CreateTicketDialog from "./CreateTicketDialog";
import SuggestedActionsCard from "./SuggestedActionsCard";
import { UserAvatar } from "@/components/UserAvatar";
import type { SuggestedAction } from "@/services/courierAnalysisService";

interface Props {
  courierId: string;
  organizationId: string;
  /** When true, disables ticket creation and deletion. */
  readOnly?: boolean;
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const ARPEGE_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  created:     { label: "Créée",       color: "bg-blue-100 text-blue-700" },
  "En cours":  { label: "En cours",    color: "bg-yellow-100 text-yellow-700" },
  Clôturée:    { label: "Clôturée",    color: "bg-green-100 text-green-700" },
  Refusée:     { label: "Refusée",     color: "bg-red-100 text-red-700" },
  Annulée:     { label: "Annulée",     color: "bg-gray-100 text-gray-500" },
};

function ArpegeStatusBadge({ status }: { status: string | null }) {
  if (!status) return null;
  const known = ARPEGE_STATUS_LABELS[status];
  return (
    <span className={`inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded-full ${known?.color ?? "bg-muted text-muted-foreground"}`}>
      {known?.label ?? status}
    </span>
  );
}

function assigneeName(t: ActionTicketWithProcedure) {
  if (!t.assignee) return null;
  return (
    [t.assignee.first_name, t.assignee.last_name].filter(Boolean).join(" ") ||
    t.assignee.email
  );
}

export default function LinkedActionsTab({ courierId, organizationId, readOnly = false }: Props) {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [suggestedAction, setSuggestedAction] = useState<SuggestedAction | null>(null);
  const [editingTicket, setEditingTicket] = useState<ActionTicketWithProcedure | null>(null);
  const [refreshingStatus, setRefreshingStatus] = useState(false);

  const { data: tickets, isLoading } = useQuery({
    queryKey: ["action-tickets", courierId],
    queryFn: () => listTicketsForCourier(courierId),
    enabled: !!courierId,
  });

  // Refresh Arpège statuses each time the tab is opened
  useEffect(() => {
    const hasArpege = tickets?.some((t) => t.arpege_demande_ref);
    if (!hasArpege || refreshingStatus) return;

    setRefreshingStatus(true);
    supabase.functions
      .invoke("check-arpege-ticket-status", {
        body: { organization_id: organizationId, courier_id: courierId },
      })
      .then(({ error }) => {
        if (error) console.warn("Arpège status refresh:", error);
        else qc.invalidateQueries({ queryKey: ["action-tickets", courierId] });
      })
      .finally(() => setRefreshingStatus(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickets !== undefined]);

  const deleteMutation = useMutation({
    mutationFn: async (ticketId: string) => {
      await deleteTicket(ticketId);
      await logEvent(organizationId, courierId, "ticket_deleted", {
        ticket_id: ticketId,
      });
    },
    onSuccess: () => {
      toast.success("Ticket supprimé");
      qc.invalidateQueries({ queryKey: ["action-tickets", courierId] });
      qc.invalidateQueries({ queryKey: ["courier-events", courierId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const openCreate = (action?: SuggestedAction) => {
    setEditingTicket(null);
    setSuggestedAction(action ?? null);
    setDialogOpen(true);
  };

  const openEdit = (t: ActionTicketWithProcedure) => {
    setEditingTicket(t);
    setSuggestedAction(null);
    setDialogOpen(true);
  };

  return (
    <div className="space-y-6">
      {/* === Tickets d'action === */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold">Tickets d'action</h3>
            <p className="text-xs text-muted-foreground">
              {(tickets?.length ?? 0)} ticket(s) lié(s) à ce courrier
            </p>
          </div>
          <Button
            size="sm"
            onClick={() => openCreate()}
            disabled={readOnly}
            title={readOnly ? "Courrier archivé — actions désactivées" : undefined}
          >
            <Plus className="h-4 w-4" />
            Créer
          </Button>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : !tickets || tickets.length === 0 ? (
          <Card className="p-4 text-center">
            <TicketIcon className="h-8 w-8 mx-auto text-muted-foreground/40 mb-2" />
            <p className="text-sm text-muted-foreground">
              Aucun ticket d'action pour ce courrier.
            </p>
          </Card>
        ) : (
          <div className="space-y-2">
            {tickets.map((t) => {
              const aName = assigneeName(t);
              return (
                <Card key={t.id} className="p-3">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <Badge
                          variant="secondary"
                          style={
                            t.procedure?.color
                              ? {
                                  backgroundColor: `${t.procedure.color}20`,
                                  color: t.procedure.color,
                                }
                              : undefined
                          }
                        >
                          {t.procedure?.name ?? "Démarche"}
                        </Badge>
                        {t.assignee ? (
                          <span
                            className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
                            title={`Affecté à ${aName}`}
                          >
                            <UserAvatar
                              firstName={t.assignee.first_name}
                              lastName={t.assignee.last_name}
                              email={t.assignee.email}
                              avatarUrl={t.assignee.avatar_url}
                              className="h-5 w-5"
                            />
                            <span>{aName}</span>
                          </span>
                        ) : (
                          <span className="text-[11px] text-muted-foreground italic">
                            Non affecté
                          </span>
                        )}
                        <span className="text-[10px] text-muted-foreground ml-auto">
                          Créé le {formatDate(t.created_at)}
                        </span>
                      </div>
                      {t.arpege_demande_ref && (
                        <p className="text-[11px] text-muted-foreground flex items-center gap-1.5 mt-0.5 flex-wrap">
                          <ExternalLink className="h-3 w-3 shrink-0" />
                          <span className="font-mono">{t.arpege_demande_ref}</span>
                          <ArpegeStatusBadge status={t.arpege_demande_status} />
                          {refreshingStatus && (
                            <span className="text-[10px] text-muted-foreground/60 italic">màj…</span>
                          )}
                        </p>
                      )}
                      {t.description ? (
                        <p className="text-sm whitespace-pre-wrap break-words mt-1">
                          {t.description}
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground italic">
                          Pas de descriptif
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-0.5 shrink-0">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-muted-foreground hover:text-foreground"
                        onClick={() => openEdit(t)}
                        disabled={readOnly}
                        title={readOnly ? "Courrier archivé" : "Modifier"}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => {
                          if (confirm("Supprimer ce ticket ?")) {
                            deleteMutation.mutate(t.id);
                          }
                        }}
                        disabled={readOnly || deleteMutation.isPending}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* === Actions suggérées (avec création de ticket depuis chaque action) === */}
      <SuggestedActionsCard
        courierId={courierId}
        onCreateTicket={(action) => openCreate(action)}
        readOnly={readOnly}
      />

      <CreateTicketDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        courierId={courierId}
        organizationId={organizationId}
        initialProcedureId={suggestedAction?.procedure_id ?? undefined}
        initialArpegeValues={suggestedAction?.prefill}
        ticket={editingTicket}
      />
    </div>
  );
}
