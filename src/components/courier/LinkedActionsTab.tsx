import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Plus,
  Trash2,
  Ticket as TicketIcon,
  ExternalLink,
  Paperclip,
  ChevronDown,
  ListChecks,
  Send,
  CheckCircle2,
  RotateCcw,
  Mail,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  listTicketsForCourier,
  deleteTicket,
  completeTask,
  reopenTask,
  sendTaskMail,
  type ActionTicketWithProcedure,
} from "@/services/actionTicketService";
import { logEvent } from "@/services/courierEventService";
import { pushIrisRequest, refreshIrisStatuses } from "@/services/irisRequestService";
import { irisStatusLabel, irisStatusVariant } from "@/lib/iris";
import { supabase } from "@/integrations/supabase/client";
import CreateTicketDialog from "./CreateTicketDialog";
import CreateTaskDialog from "./CreateTaskDialog";
import { taskAssigneeLabel } from "@/lib/action-task";
import SuggestedActionsCard from "./SuggestedActionsCard";
import { UserAvatar } from "@/components/UserAvatar";
import type { SuggestedAction } from "@/services/courierAnalysisService";

interface Props {
  courierId: string;
  organizationId: string;
  /** Organisation gestionnaire du courrier : destinataire par défaut d'une demande. */
  courierSocleOrganizationId?: string | null;
  /** When true, disables ticket creation and deletion. */
  readOnly?: boolean;
  /**
   * Motif pour lequel ce courrier n'accepte pas encore de nouvelle action
   * (voir `courierCreationBlockReason`) ; `null` si la création est permise.
   * Les actions existantes restent consultables et supprimables.
   */
  creationBlockedReason?: string | null;
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

/**
 * Suivi de la demande côté Iris — lecture seule : une fois déposée, la demande
 * est instruite là-bas, Clara n'en montre que l'état. Le renvoi ne se propose
 * que sur un dépôt jamais abouti.
 */
function IrisRequestLine({
  ticket,
  onRetry,
  retrying,
  refreshing,
  readOnly,
}: {
  ticket: ActionTicketWithProcedure;
  onRetry: (ticketId: string) => void;
  retrying: boolean;
  /** Relecture de l'état chez Iris en cours (ouverture de l'onglet). */
  refreshing: boolean;
  readOnly: boolean;
}) {
  if (ticket.iris_request_id) {
    const label = irisStatusLabel(ticket.iris_status);
    return (
      <>
        <p className="text-[11px] text-muted-foreground flex items-center gap-1.5 mt-0.5 flex-wrap">
          <ExternalLink className="h-3 w-3 shrink-0" />
          {ticket.iris_url ? (
            <a
              href={ticket.iris_url}
              target="_blank"
              rel="noreferrer"
              className="font-mono underline underline-offset-2 hover:text-foreground"
            >
              {ticket.iris_reference ?? "Demande Iris"}
            </a>
          ) : (
            <span className="font-mono">{ticket.iris_reference ?? "Demande Iris"}</span>
          )}
          {label && (
            <Badge variant={irisStatusVariant(ticket.iris_status)} className="text-[10px] px-1.5 py-0">
              {label}
            </Badge>
          )}
          {refreshing && (
            <span className="text-[10px] text-muted-foreground/60 italic">màj…</span>
          )}
        </p>
        {/* Demande déposée mais incomplète : la pièce manquante se dit ici,
            sous la référence — le toast du dépôt, lui, est déjà loin. */}
        {ticket.iris_attachments_error && (
          <p className="text-[11px] text-destructive flex items-start gap-1.5 mt-0.5">
            <Paperclip className="h-3 w-3 shrink-0 mt-0.5" />
            <span>{ticket.iris_attachments_error}</span>
          </p>
        )}
      </>
    );
  }

  if (!ticket.iris_last_error) return null;

  return (
    <p className="text-[11px] text-destructive flex items-center gap-1.5 mt-0.5 flex-wrap">
      <span>Non transmise à Iris : {ticket.iris_last_error}</span>
      {!readOnly && (
        <Button
          size="sm"
          variant="outline"
          className="h-6 px-2 text-[11px]"
          disabled={retrying}
          onClick={() => onRetry(ticket.id)}
        >
          {retrying ? "Envoi…" : "Renvoyer"}
        </Button>
      )}
    </p>
  );
}

function userLabel(u: ActionTicketWithProcedure["assignee"]) {
  if (!u) return null;
  return [u.first_name, u.last_name].filter(Boolean).join(" ") || u.email;
}

/**
 * Tâche : action interne affectée. Statut, affecté, commentaire, clôture
 * (depuis l'écran ou le lien du mail) et relances.
 */
function TaskCardBody({ ticket: t }: { ticket: ActionTicketWithProcedure }) {
  const done = t.status === "done";
  const completer = userLabel(t.completer ?? null);
  const closedBy =
    t.completed_via === "lien"
      ? `par ${taskAssigneeLabel(t)} (lien du mail)`
      : completer
        ? `par ${completer}`
        : null;
  return (
    <>
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <Badge variant="outline" className="gap-1">
          <ListChecks className="h-3 w-3" />
          Tâche
        </Badge>
        {done ? (
          <Badge className="bg-success text-success-foreground hover:bg-success/90">Terminée</Badge>
        ) : (
          <Badge className="bg-warning text-warning-foreground hover:bg-warning/90">À faire</Badge>
        )}
        <span className="text-[10px] text-muted-foreground ml-auto">
          Créée le {formatDate(t.created_at)}
        </span>
      </div>
      <p className={`text-sm font-medium break-words ${done ? "line-through text-muted-foreground" : ""}`}>
        {t.title}
      </p>
      <p className="text-[11px] text-muted-foreground flex items-center gap-1.5 mt-0.5 flex-wrap">
        <Mail className="h-3 w-3 shrink-0" />
        <span>
          Affectée à {taskAssigneeLabel(t)}
          {t.assignee_name && t.assignee_email ? ` (${t.assignee_email})` : ""}
        </span>
      </p>
      {t.description && (
        <p className="text-sm whitespace-pre-wrap break-words mt-1">{t.description}</p>
      )}
      {done && (
        <p className="text-[11px] text-muted-foreground mt-1">
          Terminée le {formatDate(t.completed_at)}
          {closedBy ? ` ${closedBy}` : ""}
        </p>
      )}
      {done && t.completion_note && (
        <p className="text-sm whitespace-pre-wrap break-words mt-1 border-l-2 pl-2 text-muted-foreground">
          {t.completion_note}
        </p>
      )}
      {!done && t.reminder_count > 0 && (
        <p className="text-[11px] text-muted-foreground mt-1">
          {t.reminder_count} relance{t.reminder_count > 1 ? "s" : ""} — dernière le{" "}
          {formatDate(t.last_reminded_at)}
        </p>
      )}
    </>
  );
}

function assigneeName(t: ActionTicketWithProcedure) {
  if (!t.assignee) return null;
  return (
    [t.assignee.first_name, t.assignee.last_name].filter(Boolean).join(" ") ||
    t.assignee.email
  );
}

export default function LinkedActionsTab({
  courierId,
  organizationId,
  courierSocleOrganizationId = null,
  readOnly = false,
  creationBlockedReason = null,
}: Props) {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [suggestedAction, setSuggestedAction] = useState<SuggestedAction | null>(null);
  const [refreshingStatus, setRefreshingStatus] = useState(false);
  const [refreshingIris, setRefreshingIris] = useState(false);

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

  // Relecture de l'état des demandes Iris à chaque ouverture de l'onglet.
  // Sans elle, l'écran montre ce que Clara a écrit AU DÉPÔT jusqu'à la
  // réconciliation nocturne (03:30) : une demande déposée le matin et résolue
  // dans la minute s'affichait « À traiter » toute la journée. Muet par
  // construction — l'agent a ouvert un onglet, il n'a rien demandé.
  useEffect(() => {
    const hasIris = tickets?.some((t) => t.iris_request_id);
    if (!hasIris || refreshingIris) return;

    setRefreshingIris(true);
    refreshIrisStatuses(courierId)
      .then(() => qc.invalidateQueries({ queryKey: ["action-tickets", courierId] }))
      .catch((e) => console.warn("Relecture Iris :", e))
      .finally(() => setRefreshingIris(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courierId, tickets !== undefined]);

  // Renvoi d'une demande restée en rade (Iris indisponible, démarche à
  // corriger…). Sûr par construction : la clé d'idempotence du ticket est
  // rejouée, un contenu identique renvoie la demande existante.
  const retryIrisMutation = useMutation({
    mutationFn: (ticketId: string) => pushIrisRequest(ticketId),
    onSuccess: (result) => {
      const label = result.reference
        ? `Demande ${result.reference} déposée dans Iris`
        : "Demande déposée dans Iris";
      // Une pièce réclamée par la démarche qui n'est pas passée ne se dit pas
      // en vert : la demande est arrivée incomplète.
      if (result.attachments_refused) toast.warning(`${label} — ${result.attachments_refused}`);
      else toast.success(label);
      qc.invalidateQueries({ queryKey: ["action-tickets", courierId] });
    },
    onError: (e: Error) => {
      toast.error(e.message);
      qc.invalidateQueries({ queryKey: ["action-tickets", courierId] });
    },
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

  // Relance : un mail neuf (nouveau lien, les précédents restent valides).
  const remindMutation = useMutation({
    mutationFn: async (ticket: ActionTicketWithProcedure) => {
      const result = await sendTaskMail(ticket.id, "remind");
      if (result.mailed || result.notified) {
        await logEvent(organizationId, courierId, "task_reminded", {
          ticket_id: ticket.id,
          title: ticket.title,
          assignee_name: taskAssigneeLabel(ticket),
          mailed: result.mailed,
        });
      }
      return result;
    },
    onSuccess: (result) => {
      if (result.mailed) toast.success("Relance envoyée par mail");
      else if (result.notified) toast.warning("Relance notifiée dans Clara, mais le mail n'est pas parti");
      else toast.error("Le mail de relance n'est pas parti (serveur d'envoi absent ou refusé)");
      qc.invalidateQueries({ queryKey: ["action-tickets", courierId] });
      qc.invalidateQueries({ queryKey: ["courier-events", courierId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const taskStatusMutation = useMutation({
    mutationFn: async ({ ticket, done }: { ticket: ActionTicketWithProcedure; done: boolean }) => {
      if (done) await completeTask(ticket.id);
      else await reopenTask(ticket.id);
      await logEvent(organizationId, courierId, done ? "task_completed" : "task_reopened", {
        ticket_id: ticket.id,
        title: ticket.title,
        via: "app",
      });
    },
    onSuccess: (_r, { done }) => {
      toast.success(done ? "Tâche marquée terminée" : "Tâche rouverte");
      qc.invalidateQueries({ queryKey: ["action-tickets", courierId] });
      qc.invalidateQueries({ queryKey: ["courier-events", courierId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const openCreate = (action?: SuggestedAction) => {
    setSuggestedAction(action ?? null);
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                disabled={readOnly || !!creationBlockedReason}
                title={readOnly ? "Courrier archivé — actions désactivées" : creationBlockedReason ?? undefined}
              >
                <Plus className="h-4 w-4" />
                Créer
                <ChevronDown className="h-3.5 w-3.5 opacity-70" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuItem onSelect={() => openCreate()} className="flex-col items-start gap-0.5">
                <span className="flex items-center gap-2 font-medium">
                  <TicketIcon className="h-4 w-4" />
                  Demande
                </span>
                <span className="text-xs text-muted-foreground pl-6">
                  Fondée sur une démarche, transmise à Iris ou Arpège
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setTaskDialogOpen(true)} className="flex-col items-start gap-0.5">
                <span className="flex items-center gap-2 font-medium">
                  <ListChecks className="h-4 w-4" />
                  Tâche
                </span>
                <span className="text-xs text-muted-foreground pl-6">
                  Action interne confiée à un agent, suivie par mail
                </span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {creationBlockedReason && !readOnly && (
          <p className="mb-3 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
            {creationBlockedReason}
          </p>
        )}

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
              const isTask = t.kind === "tache";
              const taskOpen = isTask && t.status !== "done";
              const taskBusy =
                (remindMutation.isPending && remindMutation.variables?.id === t.id) ||
                (taskStatusMutation.isPending && taskStatusMutation.variables?.ticket.id === t.id);
              return (
                <Card key={t.id} className="p-3">
                  <div className="flex items-start gap-3">
                    {isTask ? (
                    <div className="flex-1 min-w-0">
                      <TaskCardBody ticket={t} />
                      {!readOnly && (
                        <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                          {taskOpen && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-xs"
                              disabled={taskBusy}
                              onClick={() => remindMutation.mutate(t)}
                            >
                              <Send className="h-3.5 w-3.5" />
                              Relancer
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-xs"
                            disabled={taskBusy}
                            onClick={() => taskStatusMutation.mutate({ ticket: t, done: taskOpen })}
                          >
                            {taskOpen ? (
                              <>
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                Marquer terminée
                              </>
                            ) : (
                              <>
                                <RotateCcw className="h-3.5 w-3.5" />
                                Rouvrir
                              </>
                            )}
                          </Button>
                        </div>
                      )}
                    </div>
                    ) : (
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        {t.procedure && (
                          <Badge
                            variant="secondary"
                            style={
                              t.procedure.color
                                ? {
                                    backgroundColor: `${t.procedure.color}20`,
                                    color: t.procedure.color,
                                  }
                                : undefined
                            }
                          >
                            {t.procedure.name}
                          </Badge>
                        )}
                        {/* Affectation : plus rien ne s'affecte dans Clara depuis
                            que toute action est une demande instruite ailleurs —
                            seuls les tickets d'avant en portent encore une. */}
                        {t.assignee && (
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
                        )}
                        <span className="text-[10px] text-muted-foreground ml-auto">
                          Créé le {formatDate(t.created_at)}
                        </span>
                      </div>
                      {t.title && (
                        <p className="text-sm font-medium break-words">{t.title}</p>
                      )}
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
                      <IrisRequestLine
                        ticket={t}
                        onRetry={(id) => retryIrisMutation.mutate(id)}
                        retrying={retryIrisMutation.isPending && retryIrisMutation.variables === t.id}
                        refreshing={refreshingIris}
                        readOnly={readOnly}
                      />
                      {t.description && (
                        <p className="text-sm whitespace-pre-wrap break-words mt-1">
                          {t.description}
                        </p>
                      )}
                    </div>
                    )}
                    <div className="flex items-center gap-0.5 shrink-0">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => {
                          if (
                            confirm(
                              isTask
                                ? "Supprimer cette tâche ? Le lien envoyé par mail ne fonctionnera plus."
                                : "Supprimer ce ticket ?",
                            )
                          ) {
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
        onCreateTicket={creationBlockedReason ? undefined : (action) => openCreate(action)}
        readOnly={readOnly}
      />

      <CreateTaskDialog
        open={taskDialogOpen}
        onOpenChange={setTaskDialogOpen}
        courierId={courierId}
        organizationId={organizationId}
      />

      <CreateTicketDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        courierId={courierId}
        organizationId={organizationId}
        initialProcedureId={suggestedAction?.procedure_id ?? undefined}
        initialArpegeValues={suggestedAction?.prefill}
        initialSoclePrefill={suggestedAction?.socle_prefill ?? undefined}
        initialArpegePrefill={suggestedAction?.arpege_prefill ?? undefined}
        initialSocleOrganizationId={suggestedAction?.socle_organization_id ?? undefined}
        courierSocleOrganizationId={courierSocleOrganizationId}
      />
    </div>
  );
}
