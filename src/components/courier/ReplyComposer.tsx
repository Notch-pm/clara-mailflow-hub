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
  resetSendMarker,
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

type ServiceSignatoryJoinRow = { signatory: ServiceSignatory | ServiceSignatory[] | null };
type SendEmailResult = { error?: string; to?: string };

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
      return ((data ?? []) as ServiceSignatoryJoinRow[])
        .map((r) => (Array.isArray(r.signatory) ? r.signatory[0] : r.signatory))
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
  // (removed: isSignatureState — replaced by signatureState/sendState pivots below)
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

  // ─── Unique signature & send states for this workflow ──────────────
  const signatureState = useMemo(
    () => (workflow?.states ?? []).find((s) => s.requires_signature === true) ?? null,
    [workflow],
  );
  const sendState = useMemo(
    () => (workflow?.states ?? []).find((s) => (s as any).is_send === true) ?? null,
    [workflow],
  );

  /**
   * Returns true if `toStateId` is reachable from `fromStateId` by following
   * the workflow transitions. A state is considered reachable from itself.
   */
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

  /** target is strictly AFTER pivotStateId in the graph (not equal, not before). */
  function isAfter(target: WorkflowState, pivotStateId: string): boolean {
    if (target.id === pivotStateId) return false;
    // After if pivot can reach target, but target cannot reach pivot.
    return canReachState(pivotStateId, target.id) && !canReachState(target.id, pivotStateId);
  }

  /** target is strictly BEFORE pivotStateId in the graph. */
  function isBefore(target: WorkflowState, pivotStateId: string): boolean {
    if (target.id === pivotStateId) return false;
    return canReachState(target.id, pivotStateId) && !canReachState(pivotStateId, target.id);
  }

  function logSignatureFlow(step: string, details: Record<string, unknown> = {}) {
    console.debug("[ReplyComposer:signature]", step, {
      courierId,
      replyId: reply?.id ?? null,
      currentState: currentState
        ? { id: currentState.id, name: currentState.name, requires_signature: currentState.requires_signature }
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
      bodyHasSignatureMarker,
      ...details,
    });
  }

  useEffect(() => {
    logSignatureFlow("state snapshot", {
      workflowStateCount: workflow?.states.length ?? 0,
      signatureState: signatureState ? { id: signatureState.id, name: signatureState.name } : null,
      sendState: sendState ? { id: sendState.id, name: sendState.name } : null,
      isSent,
      outgoingTransitions: outgoingTransitions.map(({ target }) => ({
        id: target.id,
        name: target.name,
        requires_signature: target.requires_signature,
        is_send: (target as any).is_send === true,
      })),
    });
  }, [currentState?.id, isSigned, signedStateId, signatoryId, selectedSignatory?.id, workflow?.states.length, outgoingTransitions.length, signatureState?.id, sendState?.id, isSent]);

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
  type SignatureAction = "sign" | "unsign" | "none";
  type SendAction = "send" | "reset_send" | "none";
  type PendingTarget = {
    fromStateId: string | null;
    fromStateName: string | null;
    id: string;
    name: string;
    category: string | null;
    requires_signature: boolean;
    is_send: boolean;
    signatureAction: SignatureAction;
    sendAction: SendAction;
  };
  const [pendingTarget, setPendingTarget] = useState<PendingTarget | null>(null);

  /**
   * Signature action implied by transitioning to `target`:
   * - "sign"   : we are leaving the signature state for a state located AFTER it,
   *              and the reply is not currently signed.
   * - "unsign" : the reply is signed and we are moving to a state located BEFORE
   *              the signature state (so the signature must be removed; it can
   *              be re-applied later by passing through the signature state again).
   */
  function computeSignatureAction(target: WorkflowState): SignatureAction {
    if (!signatureState || !currentState) return "none";
    // Signing happens when leaving the signature state going forward.
    if (currentState.id === signatureState.id && isAfter(target, signatureState.id)) {
      if (!isSigned || !bodyHasSignatureMarker) return "sign";
      return "none";
    }
    // Unsigning happens when going to a state strictly before the signature state.
    if (isSigned && isBefore(target, signatureState.id)) return "unsign";
    return "none";
  }

  /**
   * Send action implied by transitioning to `target`:
   * - "send"       : we are leaving the send state for a state located AFTER it,
   *                  the reply channel is email, and it has not yet been sent.
   * - "reset_send" : we are moving to a state located BEFORE the send state on
   *                  a reply that was previously sent — clear the sent marker
   *                  so it can be re-sent the next time it crosses the send state.
   */
  function computeSendAction(target: WorkflowState): SendAction {
    if (!sendState || !currentState) return "none";
    if (currentState.id === sendState.id && isAfter(target, sendState.id)) {
      if (channel === "email" && !isSent) return "send";
      return "none";
    }
    if (isSent && isBefore(target, sendState.id)) return "reset_send";
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
      if (target.signatureAction === "sign" && !signatoryId) {
        logSignatureFlow("transition:blocked missing signatory", { target });
        throw new Error("Veuillez sélectionner un signataire avant de passer à cet état.");
      }
      const sigAction = target.signatureAction;
      const sendAction = target.sendAction;
      const ensured = await ensureReply();
      logSignatureFlow("transition:reply ensured", { target, sigAction, sendAction, ensuredReplyId: ensured.id });

      if (sigAction === "sign") {
        const newBody = await buildSignedBody();
        await signReply(organizationId, courierId, ensured.id, {
          bodyHtml: newBody,
          signedBy: currentUserId!,
          signedStateId: target.fromStateId,
        });
        setBody(newBody);
        logSignatureFlow("transition:signed", {
          signedStateId: target.fromStateId,
          newBodyLength: newBody.length,
          newBodyHasMarker: /signature-clara/i.test(newBody),
        });
      } else if (sigAction === "unsign") {
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

      // Reset send marker BEFORE the state change, so the reply becomes
      // re-sendable as soon as it crosses the send state again.
      if (sendAction === "reset_send") {
        console.debug("[ReplyComposer:send] reset send marker", { target, replyId: ensured.id });
        await resetSendMarker(organizationId, courierId, ensured.id);
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

      // Auto-send the email when LEAVING a send state for a state located after it.
      if (sendAction === "send") {
        console.debug("[ReplyComposer:send] auto-send triggered", { target, replyId: ensured.id });
        const { data, error } = await supabase.functions.invoke("send-courier-reply", {
          body: { reply_id: ensured.id, organization_id: organizationId },
        });
        if (error) throw new Error(error.message);
        const result = data as SendEmailResult | null;
        if (result?.error) throw new Error(result.error);
        return { sentTo: result?.to ?? null, didReset: false };
      }
      return { sentTo: null, didReset: sendAction === "reset_send" };
    },
    onSuccess: (result) => {
      setDirty(false);
      setPendingTarget(null);
      queryClient.invalidateQueries({ queryKey: ["courier-reply", courierId] });
      queryClient.invalidateQueries({ queryKey: ["courier-events", courierId] });
      queryClient.invalidateQueries({ queryKey: ["mailbox-couriers"] });
      refetchReply();
      if (result?.sentTo) {
        toast.success(`Courriel envoyé à ${result.sentTo}`);
      } else if (result?.didReset) {
        toast.success("Retour en arrière : la réponse pourra être renvoyée.");
      } else {
        toast.success("État de la réponse mis à jour");
      }
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
      const result = data as SendEmailResult | null;
      if (result?.error) throw new Error(result.error);
      return result;
    },
    onSuccess: (data) => {
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
    // Only gate signing requirements when the transition will actually sign.
    if (target.signatureAction === "sign") {
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
            const targetIsSend = (target as any).is_send === true;
            const requiresSig = target.requires_signature === true;
            const sigAction = computeSignatureAction(target);
            const sendAction = computeSendAction(target);
            const targetPayload: PendingTarget = {
              fromStateId: currentState?.id ?? null,
              fromStateName: currentState?.name ?? null,
              id: target.id,
              name: target.name,
              category: target.category,
              requires_signature: requiresSig,
              is_send: targetIsSend,
              signatureAction: sigAction,
              sendAction,
            };

            const reason = reasonForTarget(targetPayload);
            const blocked = !!reason;
            const willSign = sigAction === "sign";
            const willSend = sendAction === "send";
            const needsConfirm =
              sigAction === "sign" ||
              sigAction === "unsign" ||
              sendAction === "send" ||
              sendAction === "reset_send";

            const btn = (
              <Button
                key={t.id}
                size="sm"
                variant={target.category === "processed" ? "default" : "secondary"}
                disabled={isBusy || readOnly || blocked}
                onClick={() => {
                  if (needsConfirm) {
                    setPendingTarget(targetPayload);
                  } else {
                    transition.mutate(targetPayload);
                  }
                }}
              >
                {willSign ? <PenLine className="mr-1.5 h-4 w-4" /> : willSend ? <Send className="mr-1.5 h-4 w-4" /> : target.category === "processing" ? <Mail className="mr-1.5 h-4 w-4" /> : <ArrowRight className="mr-1.5 h-4 w-4" />}
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
            const sigAction = pendingTarget.signatureAction;
            const sendAction = pendingTarget.sendAction;
            let title = "Confirmer le changement d'état";
            let description = `Confirmez le passage à l'état « ${pendingTarget.name} ».`;
            let confirmLabel = "Confirmer";

            if (sigAction === "sign") {
              title = "Signer et passer à l'état suivant";
              description = `Votre signature manuscrite va être apposée à la réponse, puis l'état passera à « ${pendingTarget.name} ». Cette action peut être annulée en revenant à un état antérieur à l'état de signature.`;
              confirmLabel = "Signer et continuer";
            } else if (sigAction === "unsign") {
              title = "Retirer la signature";
              description = `Le passage à l'état « ${pendingTarget.name} » va supprimer la signature actuelle de la réponse. Vous pourrez la réapposer en repassant par l'état de signature.`;
              confirmLabel = "Retirer la signature";
            } else if (sendAction === "send") {
              title = "Envoyer le courriel";
              description = `Le passage à l'état « ${pendingTarget.name} » va déclencher l'envoi du courriel à ${senderEmail ?? "l'usager"}.`;
              confirmLabel = "Envoyer et continuer";
            } else if (sendAction === "reset_send") {
              title = "Annuler l'envoi";
              description = `Le passage à l'état « ${pendingTarget.name} » va réinitialiser le marqueur d'envoi de la réponse, qui pourra à nouveau être envoyée si elle repasse par l'état d'envoi.`;
              confirmLabel = "Confirmer le retour";
            }

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
