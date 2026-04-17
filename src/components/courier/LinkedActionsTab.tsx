import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2, Ticket as TicketIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { listTicketsForCourier, deleteTicket } from "@/services/actionTicketService";
import { logEvent } from "@/services/courierEventService";
import CreateTicketDialog from "./CreateTicketDialog";
import SuggestedActionsCard from "./SuggestedActionsCard";

interface Props {
  courierId: string;
  organizationId: string;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function LinkedActionsTab({ courierId, organizationId }: Props) {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [initialDescription, setInitialDescription] = useState("");

  const { data: tickets, isLoading } = useQuery({
    queryKey: ["action-tickets", courierId],
    queryFn: () => listTicketsForCourier(courierId),
    enabled: !!courierId,
  });

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

  const openCreate = (desc = "") => {
    setInitialDescription(desc);
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
          <Button size="sm" onClick={() => openCreate("")}>
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
            {tickets.map((t) => (
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
                      <span className="text-[10px] text-muted-foreground">
                        Créé le {formatDate(t.created_at)}
                      </span>
                    </div>
                    {t.description ? (
                      <p className="text-sm whitespace-pre-wrap break-words">
                        {t.description}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground italic">
                        Pas de descriptif
                      </p>
                    )}
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
                    onClick={() => {
                      if (confirm("Supprimer ce ticket ?")) {
                        deleteMutation.mutate(t.id);
                      }
                    }}
                    disabled={deleteMutation.isPending}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* === Actions suggérées (avec création de ticket depuis chaque action) === */}
      <SuggestedActionsCard
        courierId={courierId}
        onCreateTicket={(action) => openCreate(action)}
      />

      <CreateTicketDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        courierId={courierId}
        organizationId={organizationId}
        initialDescription={initialDescription}
      />
    </div>
  );
}
