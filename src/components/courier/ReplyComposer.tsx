import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Mail, Send, Save, ArrowRight, Lock, PenLine, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { listServices } from "@/services/orgServiceService";
import { supabase } from "@/integrations/supabase/client";
import {
  getReplyForCourier,
  getReplyWorkflow,
  createReply,
  updateReplyContent,
  transitionReplyState,
  signReply,
  unsignReply,
  stripSignatureBlock,
} from "@/services/courierReplyService";
import { getSignatureUrl } from "@/services/signatoryService";
import { useAuth } from "@/contexts/AuthContext";
import type { CourierChannel, CourierParticipant, WorkflowState } from "@/types/courier";
import { cn } from "@/lib/utils";
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

interface ServiceSignatory {
  id: string;
  first_name: string;
  last_name: string;
  title: string | null;
  user_id: string | null;
  signature_storage_key: string | null;
}

interface Props {
  courierId: string;
  organizationId: string;
  parentSubject: string | null;
  assignedService: string | null;
  sender: CourierParticipant | null;
  readOnly?: boolean;
  onStateChange?: (state: { name: string; category: string | null } | null) => void;
}

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
  const { user } = useAuth();
  const currentUserId = user?.id ?? null;

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

  // 4. Signataires associés au service instructeur
  const { data: serviceSignatories = [] } = useQuery({
    queryKey: ["service-signatories-detailed", currentService?.id],
    queryFn: async (): Promise<ServiceSignatory[]> => {
      const { data, error } = await supabase
        .from("service_signatories")
        .select("signatory:signatories(id, first_name, last_name, title, user_id, signature_storage_key)")
        .eq("service_id", currentService!.id);
      if (error) throw error;
      return (data ?? [])
        .map((r: any) => r.signatory)
        .filter(Boolean) as ServiceSignatory[];
    },
    enabled: !!currentService?.id,
  });

  // Local UI state
  const [channel, setChannel] = useState<CourierChannel>("paper");
  const [body, setBody] = useState<string>("");
  const [signatoryId, setSignatoryId] = useState<string>("");
  const [dirty, setDirty] = useState(false);

  // Hydrate local state from reply / defaults whenever the reply or courier changes
  useEffect(() => {
    if (reply) {
      setChannel(reply.channel);
      const meta = (reply.metadata as { body_html?: string; signatory_id?: string | null } | null) ?? {};
      setBody(meta.body_html ?? "");
      setSignatoryId(meta.signatory_id ?? "");
    } else {
      setChannel(canEmail ? "email" : "paper");
      setBody("");
      setSignatoryId("");
    }
    setDirty(false);
  }, [reply, courierId, canEmail]);

  // Resolve current state of the reply
  const currentState = useMemo(() => {
    if (!workflow) return null;
    const stateId = reply?.workflow_state_id ?? workflow.initialState?.id ?? null;
    return workflow.states.find((s) => s.id === stateId) ?? workflow.initialState ?? null;
  }, [workflow, reply]);

  const replyMeta = (reply?.metadata as {
    body_html?: string | null;
    signed_at?: string | null;
    signed_by?: string | null;
    signed_state_id?: string | null;
    sent_email_at?: string | null;
  } | null) ?? {};
  const isSigned = !!replyMeta.signed_at;
  const signedStateId = replyMeta.signed_state_id ?? null;
  const isSent = !!replyMeta.sent_email_at;
  const isSignatureState = (currentState as any)?.requires_signature === true;
  const bodyHasSignatureMarker = /data-signature-block=["']true["']|signature-clara/i.test(body);
  const isFinal = currentState?.category === "processed" || currentState?.is_final === true;
  const editorDisabled = !!readOnly || isFinal || isSigned;
  const canSendEmail = channel === "email" && isFinal && !!reply && !isSent && !!senderEmail;

  const selectedSignatory = useMemo(
    () => serviceSignatories.find((s) => s.id === signatoryId) ?? null,
    [serviceSignatories, signatoryId],
  );

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

  const signatureStates = useMemo(
    () => (workflow?.states ?? []).filter((s) => (s as any).requires_signature === true),
    [workflow],
  );

  function canReachState(fromStateId: string, toStateId: string): boolean {
    if (!workflow) return false;
    if (fromStateId === toStateId) return true;
    const queue = [fromStateId];
    const seen = new Set<string>();
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const t of workflow.transitions.filter((tr) => tr.from_state_id === id)) {
        if (t.to_state_id === toStateId) return true;
        queue.push(t.to_state_id);
      }
    }
    return false;
  }

  function isBeforeSignatureState(target: WorkflowState, signatureStateId: string | null): boolean {
    const sigIds = signatureStateId ? [signatureStateId] : signatureStates.map((s) => s.id);
    return sigIds.some((sigId) => target.id !== sigId && canReachState(target.id, sigId));
  }

  function isPostSignatureTarget(target: WorkflowState): boolean {
    if (!currentState || target.id === currentState.id) return false;
    if (target.is_final || target.category === "processed") return true;
    return !isBeforeSignatureState(target, currentState.id);
  }

  function logSignatureFlow(step: string, details: Record<string, unknown> = {}) {
    console.debug("[ReplyComposer:signature]", step, {
      courierId,
      replyId: reply?.id ?? null,
      currentState: currentState
        ? { id: currentState.id, name: currentState.name, requires_signature: (currentState as any).requires_signature }
        : null,
      isSigned,
      signedStateId,
      signatoryId: signatoryId || null,
      selectedSignatory: selectedSignatory
        ? {
            id: selectedSignatory.id,
            user_id: selectedSignatory.user_id,
            has_signature_storage_key: !!selectedSignatory.signature_storage_key,
          }
        : null,
      bodyHasMarker: /data-signature-block=["']true["']|signature-clara/i.test(body),
      replyBodyHasMarker: /data-signature-block=["']true["']|signature-clara/i.test(replyMeta.body_html ?? ""),
      ...details,
    });
  }

  useEffect(() => {
    logSignatureFlow("state snapshot", {
      workflowStateCount: workflow?.states.length ?? 0,
      signatureStates: signatureStates.map((s) => ({ id: s.id, name: s.name })),
      outgoingTransitions: outgoingTransitions.map(({ target }) => ({
        id: target.id,
        name: target.name,
        requires_signature: (target as any).requires_signature,
      })),
    });
  }, [currentState?.id, isSigned, signedStateId, signatoryId, selectedSignatory?.id, workflow?.states.length, outgoingTransitions.length]);

  // ─── Mutations ──────────────────────────────────────────────────────

  async function ensureReply(): Promise<{ id: string }> {
    const sigPayload = signatoryId ? signatoryId : null;
    if (reply) {
      await updateReplyContent(organizationId, reply.id, {
        channel,
        bodyHtml: body,
        signatoryId: sigPayload,
      });
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
    if (sigPayload) {
      await updateReplyContent(organizationId, created.id, { signatoryId: sigPayload });
    }
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

  // Pending transition awaiting confirmation modal
  type TransitionAction = "sign" | "unsign" | "none";
  type PendingTarget = {
    id: string;
    name: string;
    category: string | null;
    requires_signature: boolean;
    action: TransitionAction;
  };
  const [pendingTarget, setPendingTarget] = useState<PendingTarget | null>(null);

  // Determine action implied by a transition: 'sign' | 'unsign' | 'none'
  // Computed at render time from the up-to-date currentState — embedded in the
  // target payload to avoid closure-staleness bugs at mutation time.
  function computeAction(target: WorkflowState): TransitionAction {
    if (isSignatureState && (!isSigned || !bodyHasSignatureMarker) && isPostSignatureTarget(target)) return "sign";
    if (isSigned && isBeforeSignatureState(target, signedStateId)) return "unsign";
    return "none";
  }

  async function buildSignedBody(): Promise<string> {
    logSignatureFlow("build signed body:start");
    if (!selectedSignatory) throw new Error("Aucun signataire sélectionné.");
    if (!selectedSignatory.signature_storage_key) {
      throw new Error("Aucune signature manuscrite enregistrée pour ce signataire.");
    }
    if (!currentUserId || selectedSignatory.user_id !== currentUserId) {
      throw new Error("Vous n'êtes pas le signataire désigné.");
    }
    const url = await getSignatureUrl(selectedSignatory.signature_storage_key);
    if (!url) throw new Error("Impossible de charger l'image de signature.");
    const dataUrl = await fetchAsDataUrl(url);
    const fullName = `${selectedSignatory.first_name} ${selectedSignatory.last_name}`.trim();
    const titleP = selectedSignatory.title
      ? `<p><em>${escapeHtml(selectedSignatory.title)}</em></p>`
      : "";
    // Use markup that Tiptap preserves: hr + paragraphs + image.
    // The image alt="signature-clara" acts as our marker for detection/stripping.
    const signatureBlock = [
      `<hr>`,
      `<p>&nbsp;</p>`,
      `<p><strong>${escapeHtml(fullName)}</strong></p>`,
      titleP,
      `<p><img src="${dataUrl}" alt="signature-clara" style="height:80px;object-fit:contain;" /></p>`,
    ].join("");
    const signedBody = `${stripSignatureBlock(body)}${signatureBlock}`;
    logSignatureFlow("build signed body:done", {
      dataUrlLength: dataUrl.length,
      signedBodyLength: signedBody.length,
      signedBodyHasMarker: /signature-clara/i.test(signedBody),
    });
    return signedBody;
  }

  const transition = useMutation({
    mutationFn: async (target: PendingTarget) => {
      logSignatureFlow("transition:start", { target });
      if (target.requires_signature && !signatoryId) {
        logSignatureFlow("transition:blocked missing signatory", { target });
        throw new Error("Veuillez sélectionner un signataire avant de passer à cet état.");
      }
      const action = target.action;
      const ensured = await ensureReply();
      logSignatureFlow("transition:reply ensured", { target, action, ensuredReplyId: ensured.id });

      if (action === "sign") {
        const newBody = await buildSignedBody();
        await signReply(organizationId, courierId, ensured.id, {
          bodyHtml: newBody,
          signedBy: currentUserId!,
          signedStateId: currentState?.id ?? null,
        });
        setBody(newBody);
        logSignatureFlow("transition:signed", {
          signedStateId: currentState?.id ?? null,
          newBodyLength: newBody.length,
          newBodyHasMarker: /signature-clara/i.test(newBody),
        });
      } else if (action === "unsign") {
        const cleaned = stripSignatureBlock(body);
        setBody(cleaned);
        await unsignReply(organizationId, courierId, ensured.id, { bodyHtml: cleaned });
        logSignatureFlow("transition:unsigned", {
          cleanedLength: cleaned.length,
          cleanedHasMarker: /data-signature-block=["']true["']|signature-clara/i.test(cleaned),
        });
      } else {
        logSignatureFlow("transition:no signature action", { target });
      }

      await transitionReplyState(
        organizationId,
        courierId,
        ensured.id,
        target.id,
        target.name,
        target.category,
      );
      logSignatureFlow("transition:state changed", { target });
    },
    onSuccess: () => {
      setDirty(false);
      setPendingTarget(null);
      queryClient.invalidateQueries({ queryKey: ["courier-reply", courierId] });
      queryClient.invalidateQueries({ queryKey: ["courier-events", courierId] });
      queryClient.invalidateQueries({ queryKey: ["mailbox-couriers"] });
      refetchReply();
      toast.success("État de la réponse mis à jour");
    },
    onError: (err: Error) => {
      setPendingTarget(null);
      toast.error(err.message);
    },
  });

  const sendEmail = useMutation({
    mutationFn: async () => {
      if (!reply) throw new Error("Aucune réponse à envoyer.");
      const { data, error } = await supabase.functions.invoke("send-courier-reply", {
        body: { reply_id: reply.id, organization_id: organizationId },
      });
      if (error) throw new Error(error.message);
      if ((data as any)?.error) throw new Error((data as any).error);
      return data;
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["courier-reply", courierId] });
      queryClient.invalidateQueries({ queryKey: ["courier-events", courierId] });
      refetchReply();
      toast.success(`Courriel envoyé à ${data?.to ?? "l'usager"}`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const isBusy = saveDraft.isPending || transition.isPending || sendEmail.isPending;

  // ─── Transition gating ──────────────────────────────────────────────
  function reasonForTarget(target: PendingTarget): string | null {
    if (target.requires_signature && !signatoryId) return "Sélectionnez d'abord un signataire.";
    // Only gate signing requirements when the transition will actually sign.
    if (target.action === "sign") {
      if (!signatoryId) return "Sélectionnez d'abord un signataire.";
      if (!selectedSignatory) return "Signataire introuvable.";
      if (!selectedSignatory.user_id || selectedSignatory.user_id !== currentUserId)
        return "Vous n'êtes pas le signataire désigné.";
      if (!selectedSignatory.signature_storage_key)
        return "Aucune signature manuscrite enregistrée pour ce signataire.";
    }
    return null;
  }

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

  const renderMaybeTooltip = (node: React.ReactNode, reason: string | null, key?: string) => {
    if (!reason) return node;
    return (
      <Tooltip key={key}>
        <TooltipTrigger asChild>
          <span tabIndex={0} className="inline-flex">{node}</span>
        </TooltipTrigger>
        <TooltipContent>{reason}</TooltipContent>
      </Tooltip>
    );
  };

  const saveDisabledReason = isSigned
    ? "Réponse verrouillée (signée)."
    : isFinal
      ? "Réponse verrouillée."
      : !dirty && !!reply
        ? "Aucune modification à enregistrer."
        : null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* Top bar: channel selector (left) + actions (right) */}
      <div className="flex flex-wrap items-end justify-between gap-3">
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

        <div className="space-y-1.5 min-w-[220px]">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
            <PenLine className="h-3.5 w-3.5" /> Signataire
          </Label>
          <Select
            value={signatoryId || "__none__"}
            onValueChange={(v) => {
              const next = v === "__none__" ? "" : v;
              setSignatoryId(next);
              setDirty(true);
            }}
            disabled={editorDisabled || serviceSignatories.length === 0}
          >
            <SelectTrigger className="h-9">
              <SelectValue
                placeholder={
                  serviceSignatories.length === 0
                    ? "Aucun signataire associé au service"
                    : "Sélectionner un signataire"
                }
              />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">— Aucun —</SelectItem>
              {serviceSignatories.map((s) => {
                const fullName = `${s.first_name} ${s.last_name}`.trim() || "—";
                return (
                  <SelectItem key={s.id} value={s.id}>
                    {fullName}
                    {s.title ? ` — ${s.title}` : ""}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {renderMaybeTooltip(
            <Button
              variant="outline"
              size="sm"
              onClick={() => saveDraft.mutate()}
              disabled={isBusy || editorDisabled || (!dirty && !!reply)}
            >
              <Save className="mr-1.5 h-4 w-4" />
              Enregistrer le brouillon
            </Button>,
            saveDisabledReason,
            "save-btn",
          )}

          {isSigned && (
            <Badge variant="secondary" className="gap-1 bg-emerald-100 text-emerald-700 border-emerald-200">
              <CheckCircle2 className="h-3 w-3" /> Signée
            </Badge>
          )}

          {outgoingTransitions.length === 0 && !isFinal && (
            <span className="text-xs text-muted-foreground italic">
              Aucune transition définie depuis cet état.
            </span>
          )}
          {outgoingTransitions.map(({ transition: t, target }) => {
            const isSend =
              target.category === "processed" && (channel === "email" || target.name.toLowerCase().includes("répond"));
            const requiresSig = (target as any).requires_signature === true;
            const action = computeAction(target);
            const targetPayload: PendingTarget = {
              id: target.id,
              name: target.name,
              category: target.category,
              requires_signature: requiresSig,
              action,
            };

            const reason = reasonForTarget(targetPayload);
            const blocked = !!reason;
            const willSign = action === "sign";

            const btn = (
              <Button
                key={t.id}
                size="sm"
                variant={target.category === "processed" ? "default" : "secondary"}
                disabled={isBusy || readOnly || blocked}
                onClick={() => {
                  // Only show the confirmation modal when the transition signs or unsigns.
                  if (action === "sign" || action === "unsign") {
                    setPendingTarget(targetPayload);
                  } else {
                    transition.mutate(targetPayload);
                  }
                }}
              >
                {willSign || requiresSig ? <PenLine className="mr-1.5 h-4 w-4" /> : (isSend ? <Send className="mr-1.5 h-4 w-4" /> : target.category === "processing" ? <Mail className="mr-1.5 h-4 w-4" /> : <ArrowRight className="mr-1.5 h-4 w-4" />)}
                {t.name || target.name}
              </Button>
            );
            return renderMaybeTooltip(btn, reason, t.id);
          })}
          {canSendEmail && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="default"
                  disabled={isBusy}
                  onClick={() => sendEmail.mutate()}
                >
                  <Send className="mr-1.5 h-4 w-4" />
                  {sendEmail.isPending ? "Envoi…" : "Envoyer"}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Envoyer à {senderEmail}</TooltipContent>
            </Tooltip>
          )}
          {isSent && (
            <Badge variant="secondary" className="gap-1 bg-emerald-100 text-emerald-700 border-emerald-200">
              <CheckCircle2 className="h-3 w-3" /> Envoyé
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

      <AlertDialog
        open={!!pendingTarget}
        onOpenChange={(open) => {
          if (!open && !transition.isPending) setPendingTarget(null);
        }}
      >
        <AlertDialogContent>
          {(() => {
            if (!pendingTarget) return null;
            const action = pendingTarget.action;
            const title =
              action === "sign"
                ? "Signer et passer à l'état suivant"
                : action === "unsign"
                  ? "Retirer la signature"
                  : "Confirmer le changement d'état";
            const description =
              action === "sign"
                ? `Votre signature manuscrite va être apposée à la réponse, puis l'état passera à « ${pendingTarget.name} ». Cette action peut être annulée en revenant à un état antérieur.`
                : action === "unsign"
                  ? `Le passage à l'état « ${pendingTarget.name} » va supprimer la signature actuelle de la réponse. Vous pourrez la réapposer en repassant par l'état de signature.`
                  : `Confirmez le passage à l'état « ${pendingTarget.name} ».`;
            const confirmLabel =
              action === "sign" ? "Signer et continuer" : action === "unsign" ? "Retirer la signature" : "Confirmer";
            return (
              <>
                <AlertDialogHeader>
                  <AlertDialogTitle>{title}</AlertDialogTitle>
                  <AlertDialogDescription>{description}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={transition.isPending}>Annuler</AlertDialogCancel>
                  <AlertDialogAction
                    disabled={transition.isPending}
                    onClick={(e) => {
                      e.preventDefault();
                      transition.mutate(pendingTarget);
                    }}
                  >
                    {confirmLabel}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </>
            );
          })()}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function fetchAsDataUrl(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Téléchargement de la signature échoué.");
  const blob = await res.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Lecture de la signature échouée."));
    reader.readAsDataURL(blob);
  });
}
