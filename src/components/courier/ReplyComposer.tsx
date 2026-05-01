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
} from "@/services/courierReplyService";
import { getSignatureUrl } from "@/services/signatoryService";
import { useAuth } from "@/contexts/AuthContext";
import type { CourierChannel, CourierParticipant } from "@/types/courier";
import { cn } from "@/lib/utils";

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

  const replyMeta = (reply?.metadata as { signed_at?: string | null; signed_by?: string | null } | null) ?? {};
  const isSigned = !!replyMeta.signed_at;
  const isSignatureState = (currentState as any)?.requires_signature === true;
  const isFinal = currentState?.category === "processed" || currentState?.is_final === true;
  const editorDisabled = !!readOnly || isFinal || isSigned;

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

  const transition = useMutation({
    mutationFn: async (target: { id: string; name: string; category: string | null; requires_signature: boolean }) => {
      if (target.requires_signature && !signatoryId) {
        throw new Error("Veuillez sélectionner un signataire avant de passer à cet état.");
      }
      if (isSignatureState && !isSigned) {
        throw new Error("La signature doit être apposée avant de passer à un état suivant.");
      }
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

  const signMutation = useMutation({
    mutationFn: async () => {
      if (!selectedSignatory) throw new Error("Aucun signataire sélectionné.");
      if (!selectedSignatory.signature_storage_key) {
        throw new Error("Aucune signature manuscrite enregistrée pour ce signataire.");
      }
      if (!currentUserId || selectedSignatory.user_id !== currentUserId) {
        throw new Error("Vous n'êtes pas le signataire désigné.");
      }
      const url = await getSignatureUrl(selectedSignatory.signature_storage_key);
      if (!url) throw new Error("Impossible de charger l'image de signature.");

      // Convertit la signature en data URL (base64) pour la rendre persistante
      // et indépendante de l'expiration des URLs signées Supabase Storage.
      const dataUrl = await fetchAsDataUrl(url);

      const fullName = `${selectedSignatory.first_name} ${selectedSignatory.last_name}`.trim();
      const titleHtml = selectedSignatory.title
        ? `<p style="margin:0 0 4px 0;font-style:italic;color:#555;">${escapeHtml(selectedSignatory.title)},</p>`
        : "";
      const signatureBlock = `
<div data-signature-block="true" style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;">
  <p style="margin:0;">&nbsp;</p>
  <p style="margin:0;font-weight:600;">${escapeHtml(fullName)}</p>
  ${titleHtml}
  <img src="${dataUrl}" alt="Signature" style="height:80px;margin-top:8px;object-fit:contain;display:block;" />
</div>`.trim();

      const newBody = `${body}${signatureBlock}`;

      const ensured = await ensureReply();
      await signReply(organizationId, courierId, ensured.id, {
        bodyHtml: newBody,
        signedBy: currentUserId,
      });
    },
    onSuccess: () => {
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ["courier-reply", courierId] });
      queryClient.invalidateQueries({ queryKey: ["courier-events", courierId] });
      refetchReply();
      toast.success("Réponse signée");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const isBusy = saveDraft.isPending || transition.isPending || signMutation.isPending;

  // ─── Sign button gating ─────────────────────────────────────────────
  let signDisabledReason: string | null = null;
  if (!signatoryId) signDisabledReason = "Sélectionnez d'abord un signataire.";
  else if (!selectedSignatory) signDisabledReason = "Signataire introuvable.";
  else if (!selectedSignatory.user_id || selectedSignatory.user_id !== currentUserId)
    signDisabledReason = "Vous n'êtes pas le signataire désigné.";
  else if (!selectedSignatory.signature_storage_key)
    signDisabledReason = "Aucune signature manuscrite enregistrée pour ce signataire.";

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

          {/* Bouton Signer (visible uniquement sur état signature non encore signé) */}
          {isSignatureState && !isSigned && (
            renderMaybeTooltip(
              <Button
                size="sm"
                variant="default"
                onClick={() => signMutation.mutate()}
                disabled={isBusy || readOnly || !!signDisabledReason}
              >
                <PenLine className="mr-1.5 h-4 w-4" />
                Signer
              </Button>,
              signDisabledReason,
              "sign-btn",
            )
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

            // Reasons to disable a transition button
            let reason: string | null = null;
            if (requiresSig && !signatoryId) reason = "Sélectionnez d'abord un signataire.";
            else if (isSignatureState && !isSigned) reason = "En attente de la signature.";

            const blocked = !!reason;

            const btn = (
              <Button
                key={t.id}
                size="sm"
                variant={target.category === "processed" ? "default" : "secondary"}
                disabled={isBusy || readOnly || blocked}
                onClick={() =>
                  transition.mutate({
                    id: target.id,
                    name: target.name,
                    category: target.category,
                    requires_signature: requiresSig,
                  })
                }
              >
                {requiresSig && <PenLine className="mr-1.5 h-4 w-4" />}
                {!requiresSig && (isSend ? <Send className="mr-1.5 h-4 w-4" /> : target.category === "processing" ? <Mail className="mr-1.5 h-4 w-4" /> : <ArrowRight className="mr-1.5 h-4 w-4" />)}
                {t.name || target.name}
              </Button>
            );
            return renderMaybeTooltip(btn, reason, t.id);
          })}
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
