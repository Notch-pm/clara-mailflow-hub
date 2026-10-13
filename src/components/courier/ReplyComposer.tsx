import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Eye, Trash2, Stamp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { listOrgsWithConfig } from "@/services/socleOrgConfigService";
import {
  listRepliesForCourier,
  deleteReply,
  getReplyWorkflow,
  createReply,
  defaultReplySubject,
  type ReplyRecord,
} from "@/services/courierReplyService";
import { activeVisaFor, listReplyVisas } from "@/services/courierVisaService";
import type { CourierParticipant } from "@/types/courier";
import { cn } from "@/lib/utils";
import { OutboundEditor, type OutboundDraft } from "./outbound/OutboundEditor";

interface Props {
  courierId: string;
  organizationId: string;
  parentSubject: string | null;
  /** Date de réception du courrier : mention obligatoire de l'accusé de réception. */
  parentReceivedAt?: string | null;
  assignedService: string | null;
  /** UUID de l'organisation gestionnaire (miroir Socle) — clé de résolution. */
  socleOrganizationId?: string | null;
  sender: CourierParticipant | null;
  /**
   * Adresse de réponse résolue par le workspace : celle du courrier, sinon
   * celle de la fiche du référentiel (voir `useCourierWorkspace`). L'email du
   * participant seul ne suffit pas — c'est un instantané du dépôt.
   */
  senderReplyEmail?: string | null;
  readOnly?: boolean;
  /**
   * Motif pour lequel ce courrier n'accepte pas encore de nouvelle réponse
   * (voir `courierCreationBlockReason`) ; `null` si la création est permise.
   * Les réponses existantes restent ouvrables.
   */
  creationBlockedReason?: string | null;
  onStateChange?: (state: { name: string; category: string | null } | null) => void;
  initialReplyId?: string | null;
  initialOpenEditor?: boolean;
}

const CHANNEL_LABELS: Record<string, string> = { email: "Courriel", paper: "Courrier", fax: "Fax" };

/**
 * Les réponses d'un courrier reçu : leur liste, et l'éditeur partagé des
 * sortants (`OutboundEditor`) pour en rédiger ou en ouvrir une.
 */
export default function ReplyComposer({
  courierId,
  organizationId,
  parentSubject,
  parentReceivedAt = null,
  assignedService,
  socleOrganizationId,
  sender,
  senderReplyEmail = null,
  readOnly,
  creationBlockedReason = null,
  onStateChange,
  initialReplyId = null,
  initialOpenEditor = false,
}: Props) {
  const queryClient = useQueryClient();
  const senderEmail = sender?.email?.trim() || senderReplyEmail?.trim() || null;

  // ─── Organisations (miroir Socle) & workflow ────────────────────────
  const { data: services } = useQuery({
    queryKey: ["socle-orgs-config", organizationId],
    queryFn: () => listOrgsWithConfig(organizationId),
    enabled: !!organizationId,
  });

  // Organisation gestionnaire résolue par UUID (fallback nom pour l'existant legacy)
  const currentService = useMemo(() => {
    if (!services) return null;
    if (socleOrganizationId) {
      const byId = services.find((o) => o.id === socleOrganizationId);
      if (byId) return byId;
    }
    if (!assignedService) return null;
    return services.find((o) => o.name.toLowerCase() === assignedService.toLowerCase()) ?? null;
  }, [socleOrganizationId, assignedService, services]);

  const replyWorkflowId = currentService?.reply_workflow_id ?? null;

  const { data: workflow } = useQuery({
    queryKey: ["reply-workflow", replyWorkflowId],
    queryFn: () => getReplyWorkflow(replyWorkflowId!),
    enabled: !!replyWorkflowId,
  });

  // ─── Replies list ───────────────────────────────────────────────────
  const { data: replies = [], refetch: refetchReplies } = useQuery({
    queryKey: ["courier-replies", courierId],
    queryFn: () => listRepliesForCourier(organizationId, courierId),
    enabled: !!organizationId && !!courierId,
  });

  // ─── View state ─────────────────────────────────────────────────────
  // "list" = liste des réponses | "editor" = éditeur pour activeReplyId (null = nouvelle)
  const [view, setView] = useState<"list" | "editor">("list");
  const [activeReplyId, setActiveReplyId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ReplyRecord | null>(null);

  // Auto-open a specific reply in editor mode when requested via navigation (e.g. from dashboard).
  const [initialApplied, setInitialApplied] = useState(false);
  useEffect(() => {
    if (initialApplied || !initialOpenEditor || !initialReplyId) return;
    if (replies.some((r) => r.id === initialReplyId)) {
      setActiveReplyId(initialReplyId);
      setView("editor");
      setInitialApplied(true);
    }
  }, [initialApplied, initialOpenEditor, initialReplyId, replies]);

  const reply = useMemo(
    () => (activeReplyId ? replies.find((r) => r.id === activeReplyId) ?? null : null),
    [replies, activeReplyId],
  );

  const replyIds = useMemo(() => replies.map((r) => r.id), [replies]);
  const { data: visas = [] } = useQuery({
    queryKey: ["reply-visas", organizationId, replyIds],
    queryFn: () => listReplyVisas(organizationId, replyIds),
    enabled: !!organizationId && replyIds.length > 0,
  });

  // La liste n'a pas d'état courant : seul l'éditeur en annonce un.
  useEffect(() => {
    if (view === "list") onStateChange?.(null);
  }, [view, onStateChange]);

  // ─── Helpers ────────────────────────────────────────────────────────
  function isReplyFinal(r: ReplyRecord): boolean {
    if (!r.workflow_state_id || !workflow) return false;
    const s = workflow.states.find((st) => st.id === r.workflow_state_id);
    return s?.category === "processed" || s?.is_final === true;
  }

  function replyStateName(r: ReplyRecord): string {
    if (!r.workflow_state_id || !workflow) return "Brouillon";
    return workflow.states.find((s) => s.id === r.workflow_state_id)?.name ?? "Brouillon";
  }

  function replyStateCategory(r: ReplyRecord): string | null {
    if (!r.workflow_state_id || !workflow) return null;
    return workflow.states.find((s) => s.id === r.workflow_state_id)?.category ?? null;
  }

  async function createDraftReply(draft: OutboundDraft): Promise<{ id: string }> {
    const created = await createReply({
      organizationId,
      parentCourierId: courierId,
      channel: draft.channel,
      bodyHtml: draft.bodyHtml,
      parentSubject,
      subject: draft.subject,
      assignedService: currentService?.name ?? assignedService,
      socleOrganizationId: currentService?.id ?? socleOrganizationId ?? null,
      initialStateId: draft.initialStateId,
      recipient: sender
        ? { name: sender.name, email: senderEmail, first_name: sender.first_name, last_name: sender.last_name }
        : null,
    });
    return { id: created.id };
  }

  // ─── Mutations ──────────────────────────────────────────────────────
  const doDelete = useMutation({
    mutationFn: async (r: ReplyRecord) => {
      await deleteReply(organizationId, courierId, r.id);
    },
    onSuccess: (_, deleted) => {
      queryClient.invalidateQueries({ queryKey: ["courier-replies", courierId] });
      queryClient.invalidateQueries({ queryKey: ["courier-events", courierId] });
      refetchReplies();
      if (activeReplyId === deleted.id) { setActiveReplyId(null); setView("list"); }
      setDeleteTarget(null);
      toast.success("Réponse supprimée");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ─── Early exits (no organization / no workflow) ────────────────────
  if (!currentService) {
    return (
      <div className="text-sm text-muted-foreground italic">
        Aucune organisation gestionnaire n'est assignée à ce courrier. Assignez une organisation pour rédiger une réponse.
      </div>
    );
  }
  if (!replyWorkflowId) {
    return (
      <div className="text-sm text-muted-foreground italic">
        Aucun workflow de réponse n'est configuré pour l'organisation « {currentService.name} ».
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════════
  // EDITOR VIEW
  // ════════════════════════════════════════════════════════════════════
  if (view === "editor") {
    return (
      <OutboundEditor
        organizationId={organizationId}
        reply={reply}
        parentCourierId={courierId}
        service={currentService}
        workflow={workflow}
        recipient={sender}
        recipientEmail={senderEmail}
        defaultSubject={defaultReplySubject(parentSubject)}
        receivedAt={parentReceivedAt}
        title={reply ? `Réponse n°${replies.indexOf(reply) + 1}` : "Nouvelle réponse"}
        onBack={() => setView("list")}
        readOnly={readOnly}
        create={createDraftReply}
        onCreated={setActiveReplyId}
        onChanged={() => { void refetchReplies(); }}
        onStateChange={onStateChange}
      />
    );
  }

  // ─── Helpers UI ─────────────────────────────────────────────────────
  const renderMaybeTooltip = (node: React.ReactNode, reason: string | null, key?: string) => {
    if (!reason) return node;
    return (
      <Tooltip key={key}>
        <TooltipTrigger asChild><span tabIndex={0} className="inline-flex">{node}</span></TooltipTrigger>
        <TooltipContent>{reason}</TooltipContent>
      </Tooltip>
    );
  };

  /** Modifiable : ni lecteur seul, ni réponse verrouillée par son état final. */
  const canEdit = (final: boolean) => !readOnly && !final;

  const dotColor = (cat: string | null) => cn(
    "h-2 w-2 rounded-full shrink-0",
    cat === "pending" && "bg-amber-500",
    cat === "processing" && "bg-blue-500",
    cat === "processed" && "bg-emerald-500",
    cat === "archived" && "bg-slate-400",
    !cat && "bg-gray-300",
  );

  // ════════════════════════════════════════════════════════════════════
  // LIST VIEW
  // ════════════════════════════════════════════════════════════════════
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">
          {replies.length === 0 ? "Aucune réponse" : `${replies.length} réponse${replies.length > 1 ? "s" : ""}`}
        </span>
        {!readOnly && (
          <Button
            size="sm"
            disabled={!!creationBlockedReason}
            onClick={() => { setActiveReplyId(null); setView("editor"); }}
          >
            <Plus className="h-4 w-4 mr-1.5" />
            Créer une réponse
          </Button>
        )}
      </div>

      {creationBlockedReason && !readOnly && (
        <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
          {creationBlockedReason}
        </p>
      )}

      {replies.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">
          Aucune réponse rédigée pour ce courrier.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {replies.map((r, i) => {
            const cat = replyStateCategory(r);
            const final = isReplyFinal(r);
            return (
              <div
                key={r.id}
                className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3"
              >
                <span className={dotColor(cat)} />
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium">Réponse n°{i + 1}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {CHANNEL_LABELS[r.channel] ?? r.channel}
                  </span>
                  {r.created_at && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      — {new Date(r.created_at).toLocaleDateString("fr-FR")}
                    </span>
                  )}
                </div>
                {(() => {
                  const state = workflow?.states.find((s) => s.id === r.workflow_state_id);
                  if (state?.requires_visa && !activeVisaFor(visas, r.id, state.id)) {
                    return (
                      <Badge variant="outline" className="text-xs shrink-0 gap-1 border-warning/50 text-warning">
                        <Stamp className="h-3 w-3" />Visa en attente
                      </Badge>
                    );
                  }
                  if (visas.some((v) => v.courier_id === r.id && !v.superseded_at)) {
                    return (
                      <Badge variant="outline" className="text-xs shrink-0 gap-1 border-primary/40 text-primary">
                        <Stamp className="h-3 w-3" />Visée
                      </Badge>
                    );
                  }
                  return null;
                })()}
                <Badge variant="outline" className="text-xs shrink-0">{replyStateName(r)}</Badge>
                <div className="flex items-center gap-1 shrink-0">
                  {/* Une réponse envoyée s'ouvre toujours — l'éditeur la rend en
                      lecture seule. Tant que le seul bouton d'ouverture était
                      le crayon, verrouillé avec l'état final, une réponse
                      partie n'était plus consultable du tout. */}
                  {renderMaybeTooltip(
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      aria-label={
                        canEdit(final)
                          ? `Modifier la réponse n°${i + 1}`
                          : `Consulter la réponse n°${i + 1}`
                      }
                      onClick={() => { setActiveReplyId(r.id); setView("editor"); }}
                    >
                      {canEdit(final) ? <Pencil className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>,
                    canEdit(final) ? null : "Réponse verrouillée : ouverture en lecture seule.",
                    `open-${r.id}`,
                  )}
                  {!readOnly &&
                    renderMaybeTooltip(
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        disabled={final}
                        aria-label={`Supprimer la réponse n°${i + 1}`}
                        onClick={() => setDeleteTarget(r)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>,
                      final ? "Réponse verrouillée (état final)." : null,
                      `del-${r.id}`,
                    )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Confirmation suppression */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer cette réponse ?</AlertDialogTitle>
            <AlertDialogDescription>Cette action est définitive.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={doDelete.isPending}>Annuler</AlertDialogCancel>
            <AlertDialogAction
              disabled={doDelete.isPending}
              onClick={() => deleteTarget && doDelete.mutate(deleteTarget)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
