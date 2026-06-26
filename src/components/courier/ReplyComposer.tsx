import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Send, Save, Lock, PenLine, X, Plus, Pencil, Trash2, ArrowLeft, Printer, ChevronDown, Sparkles } from "lucide-react";
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
  SelectGroup,
  SelectLabel,
  SelectSeparator,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { listServices } from "@/services/orgServiceService";
import { supabase } from "@/integrations/supabase/client";
import {
  listRepliesForCourier,
  deleteReply,
  getReplyWorkflow,
  createReply,
  updateReplyContent,
  transitionReplyState,
  signReply,
  unsignReply,
  stripSignatureBlock,
  type ReplyRecord,
} from "@/services/courierReplyService";
import { getSignatureUrl } from "@/services/signatoryService";
import { useAuth } from "@/contexts/AuthContext";
import { printReply, buildContactBlock } from "@/utils/printReply";
import { getOrgHtmlTemplate } from "@/services/templateService";
import { draftReply } from "@/services/courierDraftService";
import { Textarea } from "@/components/ui/textarea";
import type { CourierChannel, CourierParticipant } from "@/types/courier";
import { cn } from "@/lib/utils";

type SendEmailResult = { error?: string; to?: string };

interface ServiceSignatory {
  id: string;
  first_name: string;
  last_name: string;
  title: string | null;
  user_id: string | null;
  signature_storage_key: string | null;
}
type ServiceSignatoryJoinRow = { signatory: ServiceSignatory | ServiceSignatory[] | null };

interface Props {
  courierId: string;
  organizationId: string;
  parentSubject: string | null;
  assignedService: string | null;
  sender: CourierParticipant | null;
  readOnly?: boolean;
  onStateChange?: (state: { name: string; category: string | null } | null) => void;
  initialReplyId?: string | null;
  initialOpenEditor?: boolean;
}

const CATEGORY_ORDER: Record<string, number> = { pending: 0, processing: 1, processed: 2, archived: 3 };

const CHANNEL_LABELS: Record<string, string> = { email: "Courriel", paper: "Courrier", fax: "Fax" };

export default function ReplyComposer({
  courierId,
  organizationId,
  parentSubject,
  assignedService,
  sender,
  readOnly,
  onStateChange,
  initialReplyId = null,
  initialOpenEditor = false,
}: Props) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const currentUserId = user?.id ?? null;
  const senderEmail = sender?.email?.trim() || null;
  const canEmail = !!senderEmail;

  // ─── Services & workflow ────────────────────────────────────────────
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

  const { data: workflow } = useQuery({
    queryKey: ["reply-workflow", replyWorkflowId],
    queryFn: () => getReplyWorkflow(replyWorkflowId!),
    enabled: !!replyWorkflowId,
  });

  // ─── Organization (for merge tags) ──────────────────────────────────
  const { data: organization } = useQuery({
    queryKey: ["org-coordinates", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organizations")
        .select("name, address_street, address_complement, address_postal_code, address_city, phone, website, contact_email")
        .eq("id", organizationId)
        .single();
      if (error) throw error;
      return data as {
        name: string;
        address_street: string | null;
        address_complement: string | null;
        address_postal_code: string | null;
        address_city: string | null;
        phone: string | null;
        website: string | null;
        contact_email: string | null;
      };
    },
    enabled: !!organizationId,
  });

  // ─── Replies list ───────────────────────────────────────────────────
  const { data: replies = [], refetch: refetchReplies } = useQuery({
    queryKey: ["courier-replies", courierId],
    queryFn: () => listRepliesForCourier(organizationId, courierId),
    enabled: !!organizationId && !!courierId,
  });

  // ─── Template ───────────────────────────────────────────────────────
  const { data: templateData } = useQuery({
    queryKey: ["org-html-template", organizationId],
    queryFn: () => getOrgHtmlTemplate(organizationId),
    enabled: !!organizationId,
  });
  const hasTemplate = !!templateData?.html;

  // ─── View state ─────────────────────────────────────────────────────
  // "list" = liste des réponses | "editor" = éditeur pour activeReplyId (null = nouvelle)
  const [view, setView] = useState<"list" | "editor">("list");
  const [activeReplyId, setActiveReplyId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ReplyRecord | null>(null);
  const [proposeFinal, setProposeFinal] = useState(false);
  const [isPrintingWithTemplate, setIsPrintingWithTemplate] = useState(false);

  const reply = useMemo(
    () => (activeReplyId ? replies.find((r) => r.id === activeReplyId) ?? null : null),
    [replies, activeReplyId],
  );

  // ─── Signatories ────────────────────────────────────────────────────
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

  // ─── Editor local state ─────────────────────────────────────────────
  const [channel, setChannel] = useState<CourierChannel>("paper");
  const [body, setBody] = useState<string>("");
  const [signatoryId, setSignatoryId] = useState<string>("");
  const [dirty, setDirty] = useState(false);

  // ─── AI assistant state ─────────────────────────────────────────────
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [aiResponseType, setAiResponseType] = useState<string>("");
  const [aiInstructions, setAiInstructions] = useState<string>("");
  const [isDrafting, setIsDrafting] = useState(false);

  useEffect(() => {
    if (view !== "editor") return;
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
  }, [reply?.id, view, canEmail]);

  useEffect(() => {
    if (signatoryId || !currentUserId || view !== "editor") return;
    const self = serviceSignatories.find((s) => s.user_id === currentUserId);
    if (self) setSignatoryId(self.id);
  }, [serviceSignatories, currentUserId, signatoryId, view]);

  // ─── Derived state (editor) ─────────────────────────────────────────
  const currentState = useMemo(() => {
    if (!workflow) return null;
    const stateId = reply?.workflow_state_id ?? workflow.initialState?.id ?? null;
    return workflow.states.find((s) => s.id === stateId) ?? workflow.initialState ?? null;
  }, [workflow, reply]);

  const replyMeta = (reply?.metadata as {
    signed_at?: string | null;
    sent_email_at?: string | null;
  } | null) ?? {};

  const isSigned = !!replyMeta.signed_at;
  const isSent = !!replyMeta.sent_email_at;
  const isFinal = currentState?.category === "processed" || currentState?.is_final === true;
  const isSignatureState = (currentState as any)?.requires_signature === true;
  const isSendState = (currentState as any)?.is_send === true;
  const editorDisabled = !!readOnly || isFinal || isSigned;

  const selectedSignatory = useMemo(
    () => serviceSignatories.find((s) => s.id === signatoryId) ?? null,
    [serviceSignatories, signatoryId],
  );
  const currentUserIsSignatory = useMemo(
    () => serviceSignatories.some((s) => s.user_id === currentUserId),
    [serviceSignatories, currentUserId],
  );

  useEffect(() => {
    if (view === "editor") {
      onStateChange?.(currentState ? { name: currentState.name, category: currentState.category } : null);
    } else {
      onStateChange?.(null);
    }
  }, [currentState, view, onStateChange]);

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

  const finalTransition = useMemo(
    () => outgoingTransitions.find((x) => x.target.is_final === true || x.target.category === "processed") ?? null,
    [outgoingTransitions],
  );

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

  async function ensureReply(): Promise<{ id: string }> {
    if (reply) {
      await updateReplyContent(organizationId, reply.id, {
        channel,
        bodyHtml: body,
        signatoryId: signatoryId || null,
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
        ? { name: sender.name, email: sender.email, first_name: sender.first_name, last_name: sender.last_name }
        : null,
    });
    if (signatoryId) {
      await updateReplyContent(organizationId, created.id, { signatoryId });
    }
    setActiveReplyId(created.id);
    return { id: created.id };
  }

  async function buildSignedBody(): Promise<string> {
    if (!selectedSignatory) throw new Error("Aucun signataire sélectionné.");
    if (!selectedSignatory.signature_storage_key)
      throw new Error("Aucune signature manuscrite enregistrée pour ce signataire.");
    if (!currentUserId || selectedSignatory.user_id !== currentUserId)
      throw new Error("Vous n'êtes pas le signataire désigné.");
    const url = await getSignatureUrl(selectedSignatory.signature_storage_key);
    if (!url) throw new Error("Impossible de charger l'image de signature.");
    const dataUrl = await fetchAsDataUrl(url);
    const fullName = `${selectedSignatory.first_name} ${selectedSignatory.last_name}`.trim();
    const titleP = selectedSignatory.title ? `<p><em>${escapeHtml(selectedSignatory.title)}</em></p>` : "";
    const signatureBlock = [
      `<p>&nbsp;</p>`, `<hr>`,
      `<p><strong>${escapeHtml(fullName)}</strong></p>`,
      titleP,
      `<p><img src="${dataUrl}" alt="signature-clara" style="height:80px;object-fit:contain;" /></p>`,
    ].join("");
    return `${stripSignatureBlock(body)}${signatureBlock}`;
  }

  // ─── Mutations ──────────────────────────────────────────────────────
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["courier-replies", courierId] });
    queryClient.invalidateQueries({ queryKey: ["courier-events", courierId] });
  };

  const saveDraft = useMutation({
    mutationFn: async () => { await ensureReply(); },
    onSuccess: () => { setDirty(false); invalidate(); toast.success("Brouillon enregistré"); },
    onError: (err: Error) => toast.error(err.message),
  });

  const doSign = useMutation({
    mutationFn: async () => {
      const ensured = await ensureReply();
      const newBody = await buildSignedBody();
      await signReply(organizationId, courierId, ensured.id, {
        bodyHtml: newBody, signedBy: currentUserId!, signedStateId: currentState?.id ?? null,
      });
      setBody(newBody);

      // Auto-advance using the transition explicitly marked as "next" in the workflow editor.
      const forward = outgoingTransitions.find(
        ({ transition }) => (transition as any).kind === "next",
      );
      if (forward) {
        await transitionReplyState(
          organizationId,
          courierId,
          ensured.id,
          forward.target.id,
          forward.target.name,
          forward.target.category,
        );
      }

    },
    onSuccess: () => {
      setDirty(false);
      invalidate();
      queryClient.invalidateQueries({ queryKey: ["mailbox-couriers"] });
      refetchReplies();
      toast.success("Réponse signée");
    },
    onError: (err: Error) => toast.error(err.message),
  });


  const doUnsign = useMutation({
    mutationFn: async () => {
      if (!reply) throw new Error("Aucune réponse.");
      const cleaned = stripSignatureBlock(body);
      setBody(cleaned);
      await unsignReply(organizationId, courierId, reply.id, { bodyHtml: cleaned });
    },
    onSuccess: () => { invalidate(); refetchReplies(); toast.success("Signature retirée"); },
    onError: (err: Error) => toast.error(err.message),
  });

  const doTransition = useMutation({
    mutationFn: async (target: { id: string; name: string; category: string | null }) => {
      const ensured = await ensureReply();
      await transitionReplyState(organizationId, courierId, ensured.id, target.id, target.name, target.category);
    },
    onSuccess: () => {
      setDirty(false);
      invalidate();
      queryClient.invalidateQueries({ queryKey: ["mailbox-couriers"] });
      refetchReplies();
      toast.success("État mis à jour");
    },
    onError: (err: Error) => toast.error(err.message),
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
      invalidate(); refetchReplies();
      toast.success(`Courriel envoyé à ${data?.to ?? "l'usager"}`);
      if (finalTransition) setProposeFinal(true);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Signature is now performed implicitly when leaving a signature-state via
  // the nominal "next" transition.
  const doSignAndAdvance = useMutation({
    mutationFn: async () => {
      const forward = outgoingTransitions.find(({ transition }) => (transition as any).kind === "next");
      if (!forward) throw new Error("Aucune transition suivante définie.");
      const ensured = await ensureReply();
      const newBody = await buildSignedBody();
      await signReply(organizationId, courierId, ensured.id, {
        bodyHtml: newBody, signedBy: currentUserId!, signedStateId: currentState?.id ?? null,
      });
      setBody(newBody);
      await transitionReplyState(
        organizationId, courierId, ensured.id,
        forward.target.id, forward.target.name, forward.target.category,
      );
    },
    onSuccess: () => {
      setDirty(false);
      invalidate();
      queryClient.invalidateQueries({ queryKey: ["mailbox-couriers"] });
      refetchReplies();
      toast.success("Réponse signée");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Email send is performed implicitly when leaving a send-state via the
  // nominal "next" transition.
  const doSendAndAdvance = useMutation({
    mutationFn: async () => {
      const forward = outgoingTransitions.find(({ transition }) => (transition as any).kind === "next");
      if (!forward) throw new Error("Aucune transition suivante définie.");
      if (!reply) throw new Error("Aucune réponse à envoyer.");
      const { data, error } = await supabase.functions.invoke("send-courier-reply", {
        body: { reply_id: reply.id, organization_id: organizationId },
      });
      if (error) throw new Error(error.message);
      const result = data as SendEmailResult | null;
      if (result?.error) throw new Error(result.error);
      await transitionReplyState(
        organizationId, courierId, reply.id,
        forward.target.id, forward.target.name, forward.target.category,
      );
      return result;
    },
    onSuccess: (data) => {
      setDirty(false);
      invalidate();
      queryClient.invalidateQueries({ queryKey: ["mailbox-couriers"] });
      refetchReplies();
      toast.success(`Courriel envoyé à ${data?.to ?? "l'usager"}`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const doDelete = useMutation({
    mutationFn: async (r: ReplyRecord) => {
      await deleteReply(organizationId, courierId, r.id);
    },
    onSuccess: (_, deleted) => {
      invalidate(); refetchReplies();
      if (activeReplyId === deleted.id) { setActiveReplyId(null); setView("list"); }
      setDeleteTarget(null);
      toast.success("Réponse supprimée");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const isBusy = saveDraft.isPending || doSign.isPending || doUnsign.isPending ||
    doTransition.isPending || sendEmail.isPending || doDelete.isPending || isPrintingWithTemplate ||
    doSignAndAdvance.isPending || doSendAndAdvance.isPending;

  // ─── Early exits (no service / no workflow) ─────────────────────────
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
        Aucun workflow de réponse n'est configuré pour le service « {currentService.name} ».
      </div>
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
  if (view === "list") {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-muted-foreground">
            {replies.length === 0 ? "Aucune réponse" : `${replies.length} réponse${replies.length > 1 ? "s" : ""}`}
          </span>
          {!readOnly && (
            <Button
              size="sm"
              onClick={() => { setActiveReplyId(null); setView("editor"); }}
            >
              <Plus className="h-4 w-4 mr-1.5" />
              Créer une réponse
            </Button>
          )}
        </div>

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
                  <Badge variant="outline" className="text-xs shrink-0">{replyStateName(r)}</Badge>
                  {!readOnly && (
                    <div className="flex items-center gap-1 shrink-0">
                      {renderMaybeTooltip(
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          disabled={final}
                          onClick={() => { setActiveReplyId(r.id); setView("editor"); }}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>,
                        final ? "Réponse verrouillée (état final)." : null,
                        `edit-${r.id}`,
                      )}
                      {renderMaybeTooltip(
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          disabled={final}
                          onClick={() => setDeleteTarget(r)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>,
                        final ? "Réponse verrouillée (état final)." : null,
                        `del-${r.id}`,
                      )}
                    </div>
                  )}
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
              <AlertDialogCancel disabled={isBusy}>Annuler</AlertDialogCancel>
              <AlertDialogAction
                disabled={isBusy}
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

  // ════════════════════════════════════════════════════════════════════
  // EDITOR VIEW
  // ════════════════════════════════════════════════════════════════════

  const printArgs = {
    bodyHtml: body,
    subject: reply?.subject ?? parentSubject,
    senderName: sender
      ? `${sender.first_name ?? ""} ${sender.last_name ?? ""}`.trim() || sender.name || null
      : null,
    date: reply?.created_at ?? new Date().toISOString(),
    organizationName: organization?.name ?? null,
    organizationCompleteHtml: organization ? buildContactBlock(organization.name, organization) : null,
    serviceName: currentService?.name ?? null,
    serviceCompleteHtml: currentService ? buildContactBlock(currentService.name, currentService) : null,
  };

  async function handleDraft() {
    if (!aiResponseType) { toast.error("Sélectionnez un type de réponse."); return; }
    setIsDrafting(true);
    try {
      const html = await draftReply({
        courierId,
        orgId: organizationId,
        responseType: aiResponseType,
        additionalInstructions: aiInstructions.trim() || undefined,
      });
      setBody(html);
      setDirty(true);
      setAiPanelOpen(false);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setIsDrafting(false);
    }
  }

  async function handlePrintPdf(useTemplate: boolean) {
    if (useTemplate && hasTemplate) {
      setIsPrintingWithTemplate(true);
      try {
        const { html } = await getOrgHtmlTemplate(organizationId);
        printReply({ ...printArgs, templateHtml: html });
      } catch (err: any) {
        toast.error(err.message);
      } finally {
        setIsPrintingWithTemplate(false);
      }
    } else {
      try {
        printReply({ ...printArgs });
      } catch (err: any) {
        toast.error(err.message);
      }
    }
  }

  const saveDisabledReason = isSigned
    ? "Réponse verrouillée (signée). Retirez la signature pour modifier."
    : isFinal
      ? "Réponse verrouillée."
      : !dirty && !!reply
        ? "Aucune modification à enregistrer."
        : null;

  const renderTransitions = () => {
    if (outgoingTransitions.length === 0) {
      return !isFinal
        ? <span className="text-xs text-muted-foreground italic">Aucune transition définie.</span>
        : null;
    }

    const nextEntry = outgoingTransitions.find(({ transition }) => (transition as any).kind === "next");
    const prevEntry = outgoingTransitions.find(({ transition }) => (transition as any).kind === "previous");
    const nominalIds = new Set([nextEntry?.transition.id, prevEntry?.transition.id].filter(Boolean));
    const others = outgoingTransitions.filter(({ transition }) => !nominalIds.has(transition.id));

    const runTransition = (target: { id: string; name: string; category: string | null; is_final?: boolean | null }) => {
      doTransition.mutate(target);
    };

    // The "next" nominal transition implicitly performs the signature / send
    // action when leaving a signature- or send-state.
    const nextRequiresSign = !!nextEntry && isSignatureState && !isSigned;
    const nextRequiresSend = !!nextEntry && isSendState && !isSent && channel === "email";
    const nextDisabledReason = nextRequiresSign
      ? (!currentUserIsSignatory
          ? "Vous n'êtes pas le signataire désigné."
          : !signatoryId
            ? "Sélectionnez un signataire."
            : null)
      : nextRequiresSend
        ? (!canEmail ? "L'expéditeur n'a pas d'adresse email." : null)
        : null;

    const onClickNext = () => {
      if (!nextEntry) return;
      if (nextRequiresSign) {
        doSignAndAdvance.mutate();
        return;
      }
      if (nextRequiresSend) {
        doSendAndAdvance.mutate();
        return;
      }
      runTransition({
        id: nextEntry.target.id,
        name: nextEntry.target.name,
        category: nextEntry.target.category,
        is_final: nextEntry.target.is_final,
      });
    };

    const nextLabel = nextEntry
      ? (nextRequiresSign
          ? "Signer et avancer"
          : nextRequiresSend
            ? (sendEmail.isPending ? "Envoi…" : "Envoyer et avancer")
            : (nextEntry.transition.name || nextEntry.target.name))
      : "";

    const nextIcon = nextRequiresSign
      ? <PenLine className="h-3.5 w-3.5" />
      : nextRequiresSend
        ? <Send className="h-3.5 w-3.5" />
        : <span className={dotColor(nextEntry?.target.category ?? null)} />;

    return (
      <div className="flex items-center gap-2">
        {prevEntry && (
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5"
            disabled={isBusy || !!readOnly}
            onClick={() => runTransition({
              id: prevEntry.target.id,
              name: prevEntry.target.name,
              category: prevEntry.target.category,
              is_final: prevEntry.target.is_final,
            })}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {prevEntry.transition.name || prevEntry.target.name}
          </Button>
        )}
        {nextEntry && renderMaybeTooltip(
          <Button
            size="sm"
            className="h-8 gap-1.5"
            disabled={isBusy || !!readOnly || !!nextDisabledReason}
            onClick={onClickNext}
          >
            {nextIcon}
            {nextLabel}
          </Button>,
          nextDisabledReason,
          "next-transition-btn",
        )}
        {others.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" className="h-8 gap-1.5" disabled={isBusy || !!readOnly}>
                Autres actions
                <ChevronDown className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {others.map(({ transition: t, target }) => (
                <DropdownMenuItem
                  key={t.id}
                  onClick={() => runTransition({
                    id: target.id,
                    name: target.name,
                    category: target.category,
                    is_final: target.is_final,
                  })}
                >
                  <div className="flex items-center gap-2">
                    <span className={dotColor(target.category)} />
                    <span>{t.name || target.name}</span>
                  </div>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    );
  };


  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* Retour à la liste */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" className="gap-1.5 px-2" onClick={() => setView("list")}>
          <ArrowLeft className="h-4 w-4" />
          Retour
        </Button>
        {reply && (
          <span className="text-sm text-muted-foreground">
            Réponse n°{replies.indexOf(reply) + 1}
          </span>
        )}
        {!reply && <span className="text-sm text-muted-foreground">Nouvelle réponse</span>}
      </div>

      {/* Barre d'actions */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        {/* Canal */}
        <div className="space-y-1.5">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">Canal</Label>
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
              <RadioGroupItem id="rc-paper" value="paper" disabled={editorDisabled} />
              <Label htmlFor="rc-paper" className="cursor-pointer text-sm font-normal">Courrier</Label>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-2">
                  <RadioGroupItem id="rc-email" value="email" disabled={editorDisabled || !canEmail} />
                  <Label
                    htmlFor="rc-email"
                    className={cn("cursor-pointer text-sm font-normal", !canEmail && "text-muted-foreground cursor-not-allowed")}
                  >
                    Courriel
                  </Label>
                </div>
              </TooltipTrigger>
              {!canEmail && <TooltipContent>L'expéditeur n'a pas d'adresse email.</TooltipContent>}
            </Tooltip>
          </RadioGroup>
        </div>

        {/* Boutons */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Enregistrer */}
          {renderMaybeTooltip(
            <Button
              variant="outline" size="sm"
              onClick={() => saveDraft.mutate()}
              disabled={isBusy || editorDisabled || (!dirty && !!reply)}
            >
              <Save className="mr-1.5 h-4 w-4" />Enregistrer
            </Button>,
            saveDisabledReason, "save-btn",
          )}

          {/* Exporter en PDF — canal courrier uniquement */}
          {channel === "paper" && (
            !hasTemplate ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => handlePrintPdf(false)}
                disabled={!body}
                className="gap-1.5"
              >
                <Printer className="h-4 w-4" />
                Exporter en PDF
              </Button>
            ) : (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!body || isPrintingWithTemplate}
                    className="gap-1.5"
                  >
                    <Printer className="h-4 w-4" />
                    {isPrintingWithTemplate ? "Chargement…" : "Exporter en PDF"}
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => handlePrintPdf(false)}>
                    Mise en page standard
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handlePrintPdf(true)}>
                    Utiliser le modèle de l'organisation
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )
          )}

          {/* Sélection du signataire (la signature est appliquée par la transition "suivante") */}
          {isSignatureState && currentUserIsSignatory && !isSigned && serviceSignatories.length > 1 && (
            <Select value={signatoryId || "__none__"} onValueChange={(v) => setSignatoryId(v === "__none__" ? "" : v)} disabled={isBusy}>
              <SelectTrigger className="h-8 w-[180px] text-sm"><SelectValue placeholder="Signataire…" /></SelectTrigger>
              <SelectContent>
                {serviceSignatories.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {`${s.first_name} ${s.last_name}`.trim()}{s.title ? ` — ${s.title}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {/* Retirer la signature */}
          {isSigned && currentUserIsSignatory && !isSent && !isFinal && (
            <Button
              size="sm" variant="outline"
              disabled={isBusy || !!readOnly}
              onClick={() => doUnsign.mutate()}
              className="gap-1.5 text-destructive border-destructive/40 hover:bg-destructive/5"
            >
              <X className="h-4 w-4" />Retirer la signature
            </Button>
          )}


          {/* Badges */}
          {isSigned && (
            <Badge variant="secondary" className="gap-1 bg-amber-50 text-amber-700 border-amber-200">
              <PenLine className="h-3 w-3" />Signée
            </Badge>
          )}
          {isSent && (
            <Badge variant="secondary" className="gap-1 bg-emerald-100 text-emerald-700 border-emerald-200">
              Envoyé
            </Badge>
          )}
          {isFinal && (
            <Badge variant="secondary" className="gap-1">
              <Lock className="h-3 w-3" />Verrouillé
            </Badge>
          )}

          {renderTransitions()}
        </div>
      </div>

      {/* Assistant IA */}
      {!body && !editorDisabled && (
        <div className="border rounded-md shrink-0">
          <button
            type="button"
            onClick={() => setAiPanelOpen((o) => !o)}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium text-violet-700 bg-violet-50 hover:bg-violet-100 transition-colors"
          >
            <Sparkles className="h-4 w-4 shrink-0" />
            Assistant IA
            <span className="ml-auto text-xs text-violet-500">{aiPanelOpen ? "▲" : "▼"}</span>
          </button>

          {aiPanelOpen && (
            <div className="p-3 space-y-3 bg-white border-t">
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">Type de réponse</p>
                <div className="flex flex-wrap gap-2">
                  {["Accusé de réception", "Suivi", "Clôture"].map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setAiResponseType(type)}
                      className={cn(
                        "px-3 py-1 rounded-full text-xs font-medium border transition-colors",
                        aiResponseType === type
                          ? "bg-violet-600 text-white border-violet-600"
                          : "border-border text-muted-foreground hover:border-violet-400 hover:text-violet-700",
                      )}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Instructions complémentaires</p>
                <Textarea
                  value={aiInstructions}
                  onChange={(e) => setAiInstructions(e.target.value)}
                  placeholder="Ex : Mentionner le délai de traitement de 15 jours, ton formel…"
                  className="text-sm min-h-[80px] resize-none"
                />
              </div>

              <Button
                size="sm"
                onClick={handleDraft}
                disabled={isDrafting || !aiResponseType}
                className="gap-1.5 bg-violet-600 hover:bg-violet-700 text-white"
              >
                <Sparkles className="h-3.5 w-3.5" />
                {isDrafting ? "Génération en cours…" : "Générer la réponse"}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Éditeur */}
      <RichTextEditor
        value={body}
        onChange={(html) => { setBody(html); setDirty(true); }}
        placeholder={
          channel === "email"
            ? `Rédigez la réponse à envoyer à ${senderEmail ?? "l'expéditeur"}…`
            : "Rédigez le contenu du courrier de réponse…"
        }
        disabled={editorDisabled}
        minHeight={220}
        className="flex-1 min-h-[220px]"
      />

      {/* Proposition état final après envoi */}
      <AlertDialog open={proposeFinal} onOpenChange={setProposeFinal}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Courriel envoyé</AlertDialogTitle>
            <AlertDialogDescription>
              Souhaitez-vous passer la réponse à l'état
              {finalTransition ? ` « ${finalTransition.target.name} »` : " final"} ?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Plus tard</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              setProposeFinal(false);
              if (finalTransition) doTransition.mutate(finalTransition.target);
            }}>
              Passer à l'état final
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

async function fetchAsDataUrl(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Téléchargement de la signature échoué.");
  const blob = await res.blob();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Lecture de la signature échouée."));
    reader.readAsDataURL(blob);
  });
}
