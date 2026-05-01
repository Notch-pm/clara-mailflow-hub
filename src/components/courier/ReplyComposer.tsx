import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Mail, Send, Save, ArrowRight, Lock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { listServices } from "@/services/orgServiceService";
import {
  getReplyForCourier,
  getReplyWorkflow,
  createReply,
  updateReplyContent,
  transitionReplyState,
} from "@/services/courierReplyService";
import type { CourierChannel, CourierParticipant } from "@/types/courier";
import { cn } from "@/lib/utils";

interface Props {
  courierId: string;
  organizationId: string;
  parentSubject: string | null;
  assignedService: string | null;
  sender: CourierParticipant | null;
  readOnly?: boolean;
  onStateChange?: (state: { name: string; category: string | null } | null) => void;
}

const stateColors: Record<string, string> = {
  pending: "bg-yellow-500",
  processing: "bg-blue-500",
  processed: "bg-green-500",
  archived: "bg-gray-500",
};

export default function ReplyComposer({
  courierId,
  organizationId,
  parentSubject,
  assignedService,
  sender,
  readOnly,
  onStateChange,
}: Props) {
  const queryClient = useQueryClient();

  const senderEmail = sender?.email?.trim() || null;
  const canEmail = !!senderEmail;

  // 1. Service of the courier (to get reply_workflow_id)
  const { data: services } = useQuery({
    queryKey: ["org-services", organizationId],
    queryFn: () => listServices(organizationId),
    enabled: !!organizationId,
  });

  const currentService = useMemo(() => {
    if (!assignedService || !services) return null;
    return services.find((s) => s.name.toLowerCase() === assignedService.toLowerCase()) ?? null;
  }, [assignedService, services]);

  const replyWorkflowId = currentService?.reply_workflow_id ?? null;

  // 2. Reply workflow definition
  const { data: workflow } = useQuery({
    queryKey: ["reply-workflow", replyWorkflowId],
    queryFn: () => getReplyWorkflow(replyWorkflowId!),
    enabled: !!replyWorkflowId,
  });

  // 3. Existing reply for this courier (if any)
  const { data: reply, refetch: refetchReply } = useQuery({
    queryKey: ["courier-reply", courierId],
    queryFn: () => getReplyForCourier(organizationId, courierId),
    enabled: !!organizationId && !!courierId,
  });

  // Local UI state
  const [channel, setChannel] = useState<CourierChannel>("paper");
  const [body, setBody] = useState<string>("");
  const [dirty, setDirty] = useState(false);

  // Hydrate local state from reply / defaults whenever the reply or courier changes
  useEffect(() => {
    if (reply) {
      setChannel(reply.channel);
      const html = (reply.metadata as { body_html?: string } | null)?.body_html ?? "";
      setBody(html);
    } else {
      setChannel(canEmail ? "email" : "paper");
      setBody("");
    }
    setDirty(false);
  }, [reply, courierId, canEmail]);

  // Resolve current state of the reply
  const currentState = useMemo(() => {
    if (!workflow) return null;
    const stateId = reply?.workflow_state_id ?? workflow.initialState?.id ?? null;
    return workflow.states.find((s) => s.id === stateId) ?? workflow.initialState ?? null;
  }, [workflow, reply]);

  const isFinal = currentState?.category === "processed" || currentState?.is_final === true;
  const editorDisabled = !!readOnly || isFinal;

  // Bubble up the current state so the parent can show it in the tab label.
  useEffect(() => {
    onStateChange?.(currentState ? { name: currentState.name, category: currentState.category } : null);
  }, [currentState, onStateChange]);

  // Available transitions from the current state
  const outgoingTransitions = useMemo(() => {
    if (!workflow || !currentState) return [];
    return workflow.transitions
      .filter((t) => t.from_state_id === currentState.id)
      .map((t) => {
        const target = workflow.states.find((s) => s.id === t.to_state_id);
        return target ? { transition: t, target } : null;
      })
      .filter((x): x is { transition: typeof workflow.transitions[number]; target: typeof workflow.states[number] } => !!x);
  }, [workflow, currentState]);

  // ─── Mutations ──────────────────────────────────────────────────────

  async function ensureReply(): Promise<{ id: string }> {
    if (reply) {
      // Persist current channel + body before any state change
      await updateReplyContent(organizationId, reply.id, { channel, bodyHtml: body });
      return { id: reply.id };
    }
    const created = await createReply({
      organizationId,
      parentCourierId: courierId,
      channel,
      bodyHtml: body,
      parentSubject,
      assignedService,
      initialStateId: workflow?.initialState?.id ?? null,
      recipient: sender
        ? {
            name: sender.name,
            email: sender.email,
            first_name: sender.first_name,
            last_name: sender.last_name,
          }
        : null,
    });
    return { id: created.id };
  }

  const saveDraft = useMutation({
    mutationFn: async () => {
      await ensureReply();
    },
    onSuccess: () => {
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ["courier-reply", courierId] });
      queryClient.invalidateQueries({ queryKey: ["courier-events", courierId] });
      toast.success("Brouillon enregistré");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const transition = useMutation({
    mutationFn: async (target: { id: string; name: string; category: string | null }) => {
      const ensured = await ensureReply();
      await transitionReplyState(
        organizationId,
        courierId,
        ensured.id,
        target.id,
        target.name,
        target.category,
      );
    },
    onSuccess: () => {
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ["courier-reply", courierId] });
      queryClient.invalidateQueries({ queryKey: ["courier-events", courierId] });
      queryClient.invalidateQueries({ queryKey: ["mailbox-couriers"] });
      refetchReply();
      toast.success("État de la réponse mis à jour");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const isBusy = saveDraft.isPending || transition.isPending;

  // ─── Render ─────────────────────────────────────────────────────────

  if (!currentService) {
    return (
      <div className="text-sm text-muted-foreground italic">
        Aucun service gestionnaire n'est assigné à ce courrier. Assignez un service pour rédiger une réponse.
      </div>
    );
  }

  if (!replyWorkflowId) {
    return (
      <div className="text-sm text-muted-foreground italic">
        Aucun workflow de réponse n'est configuré pour le service « {currentService.name} ». Configurez-le dans les paramètres du service.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {/* Channel selector */}
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">Canal de réponse</Label>
          <RadioGroup
            value={channel}
            onValueChange={(v) => {
              if (editorDisabled) return;
              if (v === "email" && !canEmail) return;
              setChannel(v as CourierChannel);
              setDirty(true);
            }}
            className="flex items-center gap-4"
          >
            <div className="flex items-center gap-2">
              <RadioGroupItem id="reply-channel-paper" value="paper" disabled={editorDisabled} />
              <Label htmlFor="reply-channel-paper" className="cursor-pointer text-sm font-normal">
                Courrier
              </Label>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-2">
                  <RadioGroupItem
                    id="reply-channel-email"
                    value="email"
                    disabled={editorDisabled || !canEmail}
                  />
                  <Label
                    htmlFor="reply-channel-email"
                    className={cn(
                      "cursor-pointer text-sm font-normal",
                      !canEmail && "text-muted-foreground cursor-not-allowed",
                    )}
                  >
                    Courriel
                  </Label>
                </div>
              </TooltipTrigger>
              {!canEmail && (
                <TooltipContent>L'expéditeur n'a pas d'adresse email renseignée.</TooltipContent>
              )}
            </Tooltip>
          </RadioGroup>
        </div>

        <div className="flex items-center gap-2">
          {currentState && (
            <Badge variant="outline" className="gap-1.5">
              <span
                className={cn(
                  "inline-block h-2 w-2 rounded-full",
                  stateColors[currentState.category] ?? "bg-muted-foreground",
                )}
              />
              {currentState.name}
            </Badge>
          )}
          {isFinal && (
            <Badge variant="secondary" className="gap-1">
              <Lock className="h-3 w-3" /> Verrouillé
            </Badge>
          )}
        </div>
      </div>

      {/* Editor */}
      <RichTextEditor
        value={body}
        onChange={(html) => {
          setBody(html);
          setDirty(true);
        }}
        placeholder={
          channel === "email"
            ? `Rédigez la réponse à envoyer à ${senderEmail ?? "l'expéditeur"}…`
            : "Rédigez le contenu du courrier de réponse…"
        }
        disabled={editorDisabled}
        minHeight={220}
        className="flex-1 min-h-[220px]"
      />

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2 border-t pt-3">
        <Button
          variant="outline"
          size="sm"
          onClick={() => saveDraft.mutate()}
          disabled={isBusy || editorDisabled || (!dirty && !!reply)}
        >
          <Save className="mr-1.5 h-4 w-4" />
          Enregistrer le brouillon
        </Button>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {outgoingTransitions.length === 0 && !isFinal && (
            <span className="text-xs text-muted-foreground italic">
              Aucune transition définie depuis cet état.
            </span>
          )}
          {outgoingTransitions.map(({ transition: t, target }) => {
            const isSend =
              target.category === "processed" && (channel === "email" || target.name.toLowerCase().includes("répond"));
            return (
              <Button
                key={t.id}
                size="sm"
                variant={target.category === "processed" ? "default" : "secondary"}
                disabled={isBusy || readOnly}
                onClick={() =>
                  transition.mutate({ id: target.id, name: target.name, category: target.category })
                }
              >
                {isSend ? <Send className="mr-1.5 h-4 w-4" /> : target.category === "processing" ? <Mail className="mr-1.5 h-4 w-4" /> : <ArrowRight className="mr-1.5 h-4 w-4" />}
                {t.name || target.name}
              </Button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
