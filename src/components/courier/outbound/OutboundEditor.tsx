import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Send, Save, Lock, PenLine, X, ArrowLeft, Printer, ChevronDown, Stamp } from "lucide-react";
import { toast } from "sonner";
import { edgeError } from "@/lib/edge-error";
import { ACKNOWLEDGMENT_TYPE } from "../../../../supabase/functions/draft-reply/logic";
import { AcknowledgmentChecklist } from "../AcknowledgmentMentions";
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
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { SocleOrgWithConfig } from "@/services/socleOrgConfigService";
import { supabase } from "@/integrations/supabase/client";
import {
  updateReplyContent,
  transitionReplyState,
  signReply,
  unsignReply,
  stripSignatureBlock,
  splitSignatureBlock,
  type ReplyRecord,
  type ReplyWorkflowData,
} from "@/services/courierReplyService";
import { getSignatureDataUrl } from "@/services/signatoryService";
import {
  activeVisaFor,
  grantVisa,
  listOrgViseurs,
  listReplyVisas,
  visaPersonName,
} from "@/services/courierVisaService";
import { ReplyVisaTrail } from "../ReplyVisaTrail";
import { isContentFrozenByVisa } from "@/lib/reply-visa";
import { Input } from "@/components/ui/input";
import { appendSignature, buildSignatureBlock } from "@/lib/reply-signature";
import { useAuth } from "@/contexts/AuthContext";
import { printReply, renderLetterHtml } from "@/utils/printReply";
import { storage } from "@/services/storageService";
import { markOutboundPosted } from "@/services/outboundCourierService";
import { postalBlocker, todayIso, type OutboundRecipientInfo } from "@/lib/outbound-channel";
import { getOrgHtmlTemplate } from "@/services/templateService";
import { visibleText } from "../../../../supabase/functions/_shared/improveMessage";
import type { CourierChannel, CourierParticipant } from "@/types/courier";
import { cn } from "@/lib/utils";
import { eventAnchor } from "@/lib/courier-events";
import { useOrgCoordinates } from "@/hooks/useOrgCoordinates";
import { buildLetterArgs } from "./letterArgs";
import { useOutboundAssistant } from "./useOutboundAssistant";
import {
  ImproveBar,
  InitiativeAssistantPanel,
  InitiativeOverwriteDialog,
  ReplyAssistantPanel,
} from "./OutboundAssistantPanels";
import { MaybeTooltip, OutboundTransitionsBar, type TransitionTarget } from "./OutboundTransitionsBar";
import { gestureBlocker, nextGesture, NO_EMAIL_REASON } from "./nextGesture";
import { PostDeclarationDialog } from "./PostDeclarationDialog";
import { VisaWaitingNotice } from "./VisaWaitingNotice";

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

/** Ce que l'éditeur sait d'un sortant pas encore enregistré, pour le créer. */
export interface OutboundDraft {
  channel: CourierChannel;
  bodyHtml: string;
  subject: string;
  initialStateId: string | null;
}

export interface OutboundEditorProps {
  organizationId: string;
  /** Le sortant édité ; `null` tant qu'il n'est pas enregistré (voir `create`). */
  reply: ReplyRecord | null;
  /**
   * Le courrier reçu auquel ce sortant répond, `null` pour un courrier à
   * l'initiative de la collectivité. Il décide où s'écrit l'historique
   * (`eventAnchor`) et quel contexte reçoit l'assistant.
   */
  parentCourierId: string | null;
  /**
   * Une réponse, ou un courrier à l'initiative de la collectivité : le
   * vocabulaire change, et l'assistant « type de réponse » n'a de sens que
   * pour une réponse (la rédaction sur consigne viendra au lot 3).
   */
  kind?: "reply" | "initiative";
  /** Organisation émettrice (miroir Socle) : signataires, viseurs, coordonnées. */
  service: SocleOrgWithConfig;
  /** Workflow réponse de l'organisation émettrice. */
  workflow: ReplyWorkflowData | undefined;
  /** Destinataire du sortant (l'expéditeur du courrier reçu, pour une réponse). */
  recipient: CourierParticipant | null;
  /** Son adresse électronique résolue — sur le courrier, sinon sur la fiche du référentiel. */
  recipientEmail: string | null;
  /** Objet proposé d'office, et indication du champ Objet. */
  defaultSubject: string;
  /** Date de réception du courrier : mention obligatoire de l'accusé de réception. */
  receivedAt?: string | null;
  /** Libellé d'en-tête (« Réponse n°2 », « Nouvelle réponse »). */
  title: string;
  onBack?: () => void;
  readOnly?: boolean;
  /** Crée le sortant au premier enregistrement ; absent, `reply` doit exister. */
  create?: (draft: OutboundDraft) => Promise<{ id: string }>;
  /** Après création : le conteneur suit désormais ce sortant. */
  onCreated?: (id: string) => void;
  /** Après chaque écriture : le conteneur relit le sortant. */
  onChanged: () => void;
  onStateChange?: (state: { name: string; category: string | null } | null) => void;
  /** Adresse postale du destinataire (courrier à l'initiative) : exigée pour déclarer « posté ». */
  recipientPostal?: OutboundRecipientInfo | null;
}

/** Le vocabulaire de l'éditeur : une réponse, ou un courrier qui ne répond à rien. */
const WORDING = {
  reply: {
    signed: "Réponse signée",
    visaed: "Réponse visée",
    lockedSigned: "Réponse verrouillée (signée). Retirez la signature pour modifier.",
    locked: "Réponse verrouillée.",
    lockedVisa: "Réponse verrouillée pendant l'étape de visa. Renvoyez-la en rédaction pour la modifier.",
    frozen: "Réponse visée : son contenu est figé. Pour le modifier, renvoyez-la en rédaction — un nouveau visa sera demandé.",
    emailPlaceholder: (to: string | null) => `Rédigez la réponse à envoyer à ${to ?? "l'expéditeur"}…`,
    paperPlaceholder: "Rédigez le contenu du courrier de réponse…",
  },
  initiative: {
    signed: "Courrier signé",
    visaed: "Courrier visé",
    lockedSigned: "Courrier verrouillé (signé). Retirez la signature pour modifier.",
    locked: "Courrier verrouillé.",
    lockedVisa: "Courrier verrouillé pendant l'étape de visa. Renvoyez-le en rédaction pour le modifier.",
    frozen: "Courrier visé : son contenu est figé. Pour le modifier, renvoyez-le en rédaction — un nouveau visa sera demandé.",
    emailPlaceholder: (to: string | null) => `Rédigez le courriel à envoyer à ${to ?? "votre destinataire"}…`,
    paperPlaceholder: "Rédigez le contenu du courrier…",
  },
} as const;

/**
 * L'éditeur d'un courrier sortant : canal, objet, corps, assistant, visa,
 * signature, transitions du workflow réponse, envoi et impression.
 *
 * Un seul éditeur pour les réponses et les courriers à l'initiative de la
 * collectivité : deux composeurs finiraient par viser, signer ou envoyer
 * chacun à leur façon.
 */
export function OutboundEditor({
  organizationId,
  reply,
  parentCourierId,
  kind = "reply",
  service: currentService,
  workflow,
  recipient: sender,
  recipientEmail,
  defaultSubject,
  receivedAt = null,
  title,
  onBack,
  readOnly,
  create,
  onCreated,
  onChanged,
  onStateChange,
  recipientPostal = null,
}: OutboundEditorProps) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const currentUserId = user?.id ?? null;
  const senderEmail = recipientEmail?.trim() || null;
  const canEmail = !!senderEmail;
  const words = WORDING[kind];

  // ─── Organization (for merge tags) ──────────────────────────────────
  const { data: organization } = useOrgCoordinates(organizationId);

  // ─── Template ───────────────────────────────────────────────────────
  const { data: templateData } = useQuery({
    queryKey: ["org-html-template", organizationId],
    queryFn: () => getOrgHtmlTemplate(organizationId),
    enabled: !!organizationId,
  });
  const hasTemplate = !!templateData?.html;

  const [isPrintingWithTemplate, setIsPrintingWithTemplate] = useState(false);

  // ─── Signatories (de l'organisation émettrice) ──────────────────────
  const { data: serviceSignatories = [] } = useQuery({
    queryKey: ["socle-org-signatories-detailed", currentService.id],
    queryFn: async (): Promise<ServiceSignatory[]> => {
      const { data, error } = await supabase
        .from("socle_organization_signatories")
        .select("signatory:signatories(id, first_name, last_name, title, user_id, signature_storage_key)")
        .eq("socle_organization_id", currentService.id);
      if (error) throw error;
      return ((data ?? []) as ServiceSignatoryJoinRow[])
        .map((r) => (Array.isArray(r.signatory) ? r.signatory[0] : r.signatory))
        .filter(Boolean) as ServiceSignatory[];
    },
  });

  // ─── Viseurs (de l'organisation émettrice) & visas du sortant ───────
  const { data: serviceViseurs = [] } = useQuery({
    queryKey: ["socle-org-viseurs-detailed", organizationId, currentService.id],
    queryFn: () => listOrgViseurs(organizationId, currentService.id),
  });

  const { data: replyVisas = [] } = useQuery({
    queryKey: ["reply-visas", organizationId, reply ? [reply.id] : []],
    queryFn: () => listReplyVisas(organizationId, [reply!.id]),
    enabled: !!organizationId && !!reply,
  });

  // ─── Editor local state ─────────────────────────────────────────────
  const [channel, setChannel] = useState<CourierChannel>("paper");
  const [visaComment, setVisaComment] = useState("");
  const [body, setBody] = useState<string>("");
  const [subject, setSubject] = useState<string>("");
  const [signatoryId, setSignatoryId] = useState<string>("");
  const [dirty, setDirty] = useState(false);

  // ─── Assistant de rédaction ─────────────────────────────────────────
  const assistant = useOutboundAssistant({
    organizationId,
    replyId: reply?.id ?? null,
    parentCourierId,
    kind,
    body,
    subject,
    setBody,
    setSubject,
    markDirty: () => setDirty(true),
  });

  useEffect(() => {
    if (reply) {
      setChannel(reply.channel);
      const meta = (reply.metadata as { body_html?: string; signatory_id?: string | null } | null) ?? {};
      setBody(meta.body_html ?? "");
      setSubject(reply.subject ?? defaultSubject);
      setSignatoryId(meta.signatory_id ?? "");
    } else {
      setChannel(canEmail ? "email" : "paper");
      setBody("");
      setSubject(defaultSubject);
      setSignatoryId("");
    }
    setVisaComment("");
    setDirty(false);
  }, [reply?.id, canEmail]);

  useEffect(() => {
    if (signatoryId || !currentUserId) return;
    const self = serviceSignatories.find((s) => s.user_id === currentUserId);
    if (self) setSignatoryId(self.id);
  }, [serviceSignatories, currentUserId, signatoryId]);

  // ─── Derived state ──────────────────────────────────────────────────
  const currentState = useMemo(() => {
    if (!workflow) return null;
    const stateId = reply?.workflow_state_id ?? workflow.initialState?.id ?? null;
    return workflow.states.find((s) => s.id === stateId) ?? workflow.initialState ?? null;
  }, [workflow, reply]);

  const replyMeta = (reply?.metadata as {
    signed_at?: string | null;
    sent_email_at?: string | null;
    visa_viseurs?: Record<string, string> | null;
  } | null) ?? {};

  const isSigned = !!replyMeta.signed_at;
  const isSent = !!replyMeta.sent_email_at;
  // Courrier postal à l'initiative : déclaré « posté » à une date choisie.
  const postedOn = (reply?.metadata as { posted_at?: string | null } | null)?.posted_at ?? null;
  const isPosted = !!postedOn;
  const postBlocker = postalBlocker(recipientPostal);
  const hasSendStep = !!workflow?.states.some((s) => s.is_send);
  const canDeclarePosted = kind === "initiative" && !!reply && !isPosted;
  const isFinal = currentState?.category === "processed" || currentState?.is_final === true;
  const isSignatureState = currentState?.requires_signature === true;
  const isSendState = currentState?.is_send === true;
  // Étape de visa : on y vise ce qu'on a lu (voir `isContentFrozenByVisa`
  // pour le contenu, figé aussi APRÈS le visa).
  const isVisaState = currentState?.requires_visa === true;
  const activeVisa = reply ? activeVisaFor(replyVisas, reply.id, currentState?.id) : null;
  const currentUserIsViseur = serviceViseurs.some((v) => v.id === currentUserId);
  // Un visa en vigueur fige le contenu jusqu'au renvoi en rédaction ou « à
  // corriger » — sinon on viserait un texte et on en signerait un autre.
  const frozenByVisa = useMemo(
    () =>
      isContentFrozenByVisa(
        currentState,
        replyVisas.filter((v) => !v.superseded_at && v.workflow_state_id).map((v) => v.workflow_state_id!),
        workflow?.transitions ?? [],
      ),
    [currentState, replyVisas, workflow],
  );
  const editorDisabled = !!readOnly || isFinal || isSigned || frozenByVisa;

  const selectedSignatory = useMemo(
    () => serviceSignatories.find((s) => s.id === signatoryId) ?? null,
    [serviceSignatories, signatoryId],
  );
  const currentUserIsSignatory = useMemo(
    () => serviceSignatories.some((s) => s.user_id === currentUserId),
    [serviceSignatories, currentUserId],
  );

  useEffect(() => {
    onStateChange?.(currentState ? { name: currentState.name, category: currentState.category } : null);
  }, [currentState, onStateChange]);

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

  // Étape de visa dont on désigne le viseur : l'étape courante tant qu'elle
  // n'est pas visée, sinon celle vers laquelle mène la transition nominale.
  const nextForward = outgoingTransitions.find(({ transition }) => transition.kind === "next") ?? null;
  const designationState = isVisaState && !activeVisa
    ? currentState
    : nextForward?.target.requires_visa
      ? nextForward.target
      : null;
  const designatedViseurId = designationState ? replyMeta.visa_viseurs?.[designationState.id] ?? "" : "";
  const designatedViseur = serviceViseurs.find((v) => v.id === designatedViseurId) ?? null;

  // ─── Helpers ────────────────────────────────────────────────────────
  /** Le courrier qui porte l'historique de ce sortant. */
  const anchor = (outboundId: string) => eventAnchor(parentCourierId, outboundId);

  async function ensureReply(): Promise<{ id: string }> {
    if (reply) {
      await updateReplyContent(organizationId, reply.id, {
        channel,
        subject,
        bodyHtml: body,
        signatoryId: signatoryId || null,
      });
      return { id: reply.id };
    }
    if (!create) throw new Error("Courrier introuvable.");
    const created = await create({
      channel,
      bodyHtml: body,
      subject,
      initialStateId: workflow?.initialState?.id ?? null,
    });
    if (signatoryId) {
      await updateReplyContent(organizationId, created.id, { signatoryId });
    }
    onCreated?.(created.id);
    return { id: created.id };
  }

  async function buildSignedBody(): Promise<string> {
    if (!selectedSignatory) throw new Error("Aucun signataire sélectionné.");
    if (!selectedSignatory.signature_storage_key)
      throw new Error("Aucune signature manuscrite enregistrée pour ce signataire.");
    if (!currentUserId || selectedSignatory.user_id !== currentUserId)
      throw new Error("Vous n'êtes pas le signataire désigné.");
    const signatureDataUrl = await getSignatureDataUrl(selectedSignatory.signature_storage_key);
    const fullName = `${selectedSignatory.first_name} ${selectedSignatory.last_name}`.trim();
    return appendSignature(
      body,
      buildSignatureBlock({ fullName, title: selectedSignatory.title, signatureDataUrl }),
    );
  }

  // ─── Mutations ──────────────────────────────────────────────────────
  const invalidate = () => {
    if (parentCourierId) queryClient.invalidateQueries({ queryKey: ["courier-replies", parentCourierId] });
    queryClient.invalidateQueries({ queryKey: ["courier-events"] });
    // Une transition peut périmer des visas (retour dans une étape de visa) :
    // la trace et l'état « à viser » se relisent avec les réponses.
    queryClient.invalidateQueries({ queryKey: ["reply-visas"] });
    queryClient.invalidateQueries({ queryKey: ["visa-queue"] });
  };

  const saveDraft = useMutation({
    mutationFn: async () => { await ensureReply(); },
    onSuccess: () => { setDirty(false); invalidate(); onChanged(); toast.success("Brouillon enregistré"); },
    onError: (err: Error) => toast.error(err.message),
  });

  const doUnsign = useMutation({
    mutationFn: async () => {
      if (!reply) throw new Error("Aucune réponse.");
      const cleaned = stripSignatureBlock(body);
      setBody(cleaned);
      await unsignReply(organizationId, anchor(reply.id), reply.id, { bodyHtml: cleaned });
    },
    onSuccess: () => { invalidate(); onChanged(); toast.success("Signature retirée"); },
    onError: (err: Error) => toast.error(err.message),
  });

  const doTransition = useMutation({
    mutationFn: async (target: { id: string; name: string; category: string | null }) => {
      const ensured = await ensureReply();
      await transitionReplyState(organizationId, anchor(ensured.id), ensured.id, target.id, target.name, target.category);
    },
    onSuccess: () => {
      setDirty(false);
      invalidate();
      queryClient.invalidateQueries({ queryKey: ["mailbox-couriers"] });
      onChanged();
      toast.success("État mis à jour");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Signature is now performed implicitly when leaving a signature-state via
  // the nominal "next" transition.
  const doSignAndAdvance = useMutation({
    mutationFn: async () => {
      const forward = outgoingTransitions.find(({ transition }) => transition.kind === "next");
      if (!forward) throw new Error("Aucune transition suivante définie.");
      const ensured = await ensureReply();
      const newBody = await buildSignedBody();
      await signReply(organizationId, anchor(ensured.id), ensured.id, {
        bodyHtml: newBody, signedBy: currentUserId!, signedStateId: currentState?.id ?? null,
      });
      setBody(newBody);
      await transitionReplyState(
        organizationId, anchor(ensured.id), ensured.id,
        forward.target.id, forward.target.name, forward.target.category,
      );
    },
    onSuccess: () => {
      setDirty(false);
      invalidate();
      queryClient.invalidateQueries({ queryKey: ["mailbox-couriers"] });
      onChanged();
      toast.success(words.signed);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Email send is performed implicitly when leaving a send-state via the
  // nominal "next" transition.
  const doSendAndAdvance = useMutation({
    mutationFn: async () => {
      const forward = outgoingTransitions.find(({ transition }) => transition.kind === "next");
      if (!forward) throw new Error("Aucune transition suivante définie.");
      if (!reply) throw new Error("Aucune réponse à envoyer.");
      // L'envoi relit la réponse en base : ce qui vient d'être tapé (objet,
      // corps) doit y être avant, sinon c'est l'ancienne version qui part.
      if (dirty) await ensureReply();
      const { data, error } = await supabase.functions.invoke("send-courier-reply", {
        body: { reply_id: reply.id, organization_id: organizationId },
      });
      if (error) throw await edgeError(error, "Envoi du courriel impossible");
      const result = data as SendEmailResult | null;
      if (result?.error) throw new Error(result.error);
      await transitionReplyState(
        organizationId, anchor(reply.id), reply.id,
        forward.target.id, forward.target.name, forward.target.category,
      );
      return result;
    },
    onSuccess: (data) => {
      setDirty(false);
      invalidate();
      queryClient.invalidateQueries({ queryKey: ["mailbox-couriers"] });
      onChanged();
      toast.success(`Courriel envoyé à ${data?.to ?? "l'usager"}`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const setViseur = useMutation({
    mutationFn: async (args: { stateId: string; userId: string | null }) => {
      const ensured = await ensureReply();
      await updateReplyContent(organizationId, ensured.id, { visaViseur: args });
    },
    onSuccess: () => { setDirty(false); invalidate(); onChanged(); },
    onError: (err: Error) => toast.error(err.message),
  });

  // Viser l'étape courante puis avancer par la transition nominale. Le serveur
  // refuse un visa d'un non-viseur et toute sortie vers l'avant sans visa.
  const doVisaAndAdvance = useMutation({
    mutationFn: async () => {
      if (!reply || !currentState) throw new Error("Aucune réponse à viser.");
      await grantVisa({
        organizationId,
        eventCourierId: anchor(reply.id),
        replyId: reply.id,
        stateId: currentState.id,
        comment: visaComment,
      });
      if (nextForward) {
        await transitionReplyState(
          organizationId, anchor(reply.id), reply.id,
          nextForward.target.id, nextForward.target.name, nextForward.target.category,
        );
      }
    },
    onSuccess: () => {
      setVisaComment("");
      invalidate();
      queryClient.invalidateQueries({ queryKey: ["mailbox-couriers"] });
      onChanged();
      toast.success(words.visaed);
    },
    onError: (err: Error) => {
      queryClient.invalidateQueries({ queryKey: ["reply-visas"] });
      toast.error(err.message);
    },
  });

  const [postDialog, setPostDialog] = useState<{ advance: boolean } | null>(null);
  const [postDate, setPostDate] = useState<string>(todayIso());

  /** La lettre telle qu'elle part : le modèle de l'organisation s'il existe. */
  async function letterHtml(): Promise<string> {
    if (hasTemplate) {
      const { html } = await getOrgHtmlTemplate(organizationId);
      const { content, signature } = splitSignatureBlock(body);
      return renderLetterHtml({ ...printArgs, bodyHtml: content, signatureHtml: signature, templateHtml: html });
    }
    return renderLetterHtml({ ...printArgs });
  }

  // Imprimer, mettre sous pli, puis déclarer « posté » : l'exemplaire conservé
  // est la lettre telle qu'elle est partie.
  const doPost = useMutation({
    mutationFn: async (args: { advance: boolean; postedOn: string }) => {
      if (!reply) throw new Error("Aucun courrier.");
      if (postBlocker) throw new Error(postBlocker);
      if (dirty) await ensureReply();
      const html = await letterHtml();
      const file = new File([html], `exemplaire posté le ${args.postedOn}.html`, { type: "text/html" });
      const doc = await storage.upload(organizationId, reply.id, file, "response");
      await markOutboundPosted({
        organizationId,
        outboundId: reply.id,
        postedOn: args.postedOn,
        postedBy: currentUserId!,
        documentId: doc.id,
      });
      if (args.advance && nextForward) {
        await transitionReplyState(
          organizationId, anchor(reply.id), reply.id,
          nextForward.target.id, nextForward.target.name, nextForward.target.category,
        );
      }
    },
    onSuccess: (_, args) => {
      setPostDialog(null);
      setDirty(false);
      invalidate();
      queryClient.invalidateQueries({ queryKey: ["courier-documents"] });
      queryClient.invalidateQueries({ queryKey: ["mailbox-couriers"] });
      onChanged();
      toast.success(`Courrier déclaré posté le ${new Date(args.postedOn).toLocaleDateString("fr-FR")}`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const isBusy = doPost.isPending || saveDraft.isPending || doUnsign.isPending ||
    doTransition.isPending || isPrintingWithTemplate ||
    doSignAndAdvance.isPending || doSendAndAdvance.isPending || assistant.isImproving ||
    setViseur.isPending || doVisaAndAdvance.isPending;

  const printArgs = buildLetterArgs({
    bodyHtml: body,
    subject,
    savedSubject: reply?.subject,
    defaultSubject,
    createdAt: reply?.created_at,
    recipient: sender,
    recipientEmail: senderEmail,
    organization,
    service: currentService,
  });

  async function handlePrintPdf(useTemplate: boolean) {
    if (useTemplate && hasTemplate) {
      setIsPrintingWithTemplate(true);
      try {
        const { html } = await getOrgHtmlTemplate(organizationId);
        // Le modèle place la signature via {{signature}} : on la sort du contenu
        // pour qu'elle n'apparaisse pas deux fois (et pas du tout si le modèle
        // n'utilise pas la variable).
        const { content, signature } = splitSignatureBlock(body);
        printReply({ ...printArgs, bodyHtml: content, signatureHtml: signature, templateHtml: html });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Impression impossible");
      } finally {
        setIsPrintingWithTemplate(false);
      }
    } else {
      try {
        printReply({ ...printArgs });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Impression impossible");
      }
    }
  }

  const saveDisabledReason = isSigned
    ? words.lockedSigned
    : isFinal
      ? words.locked
      : isVisaState
        ? words.lockedVisa
      : !dirty && !!reply
        ? "Aucune modification à enregistrer."
        : null;

  // Le geste que porte la transition nominale en quittant l'étape.
  const gesture = nextForward
    ? nextGesture({
        isVisaState,
        hasActiveVisa: !!activeVisa,
        isSignatureState,
        isSigned,
        isSendState,
        isSent,
        channel,
        canDeclarePosted,
      })
    : null;
  const nextBlocker = gestureBlocker(gesture, {
    postBlocker,
    isViseur: currentUserIsViseur,
    isSignatory: currentUserIsSignatory,
    hasSignatory: !!signatoryId,
    canEmail,
  });

  function runGesture() {
    if (gesture === "post") {
      setPostDate(todayIso());
      setPostDialog({ advance: true });
    } else if (gesture === "visa") doVisaAndAdvance.mutate();
    else if (gesture === "sign") doSignAndAdvance.mutate();
    else if (gesture === "send") doSendAndAdvance.mutate();
  }

  const transitionsBar = (
    <OutboundTransitionsBar
      entries={outgoingTransitions}
      isFinal={isFinal}
      visaGate={isVisaState && !activeVisa && currentState && workflow
        ? { visaStateId: currentState.id, transitions: workflow.transitions }
        : null}
      gesture={gesture}
      nextBlocker={nextBlocker}
      sending={doSendAndAdvance.isPending}
      busy={isBusy}
      readOnly={!!readOnly}
      onRun={(target: TransitionTarget) => doTransition.mutate(target)}
      onGesture={runGesture}
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* Retour à la liste */}
      <div className="flex items-center gap-2">
        {onBack && (
          <Button variant="ghost" size="sm" className="gap-1.5 px-2" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
            Retour
          </Button>
        )}
        <span className="text-sm text-muted-foreground">{title}</span>
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
              {!canEmail && <TooltipContent>{NO_EMAIL_REASON}</TooltipContent>}
            </Tooltip>
          </RadioGroup>
        </div>

        {/* Boutons */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Enregistrer */}
          <MaybeTooltip reason={saveDisabledReason}>
            <Button
              variant="outline" size="sm"
              onClick={() => saveDraft.mutate()}
              disabled={isBusy || editorDisabled || (!dirty && !!reply)}
            >
              <Save className="mr-1.5 h-4 w-4" />Enregistrer
            </Button>
          </MaybeTooltip>

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

          {/* Désignation du viseur de l'étape de visa (courante ou suivante) */}
          {designationState && !readOnly && !isFinal && (
            <Select
              value={designatedViseurId || "__none__"}
              onValueChange={(v) => setViseur.mutate({ stateId: designationState.id, userId: v === "__none__" ? null : v })}
              disabled={isBusy || serviceViseurs.length === 0}
            >
              <SelectTrigger className="h-8 w-[200px] text-sm" aria-label={`Viseur — ${designationState.name}`}>
                <Stamp className="mr-1.5 h-3.5 w-3.5 text-primary" />
                <SelectValue placeholder="Viseur…" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>Viseur — {designationState.name}</SelectLabel>
                  <SelectItem value="__none__">Tout viseur de l'organisation</SelectItem>
                  {serviceViseurs.map((v) => (
                    <SelectItem key={v.id} value={v.id}>{visaPersonName(v)}</SelectItem>
                  ))}
                </SelectGroup>
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
          {/* Sans étape d'envoi dans le workflow, la déclaration se fait d'ici. */}
          {canDeclarePosted && channel === "paper" && !hasSendStep && !isFinal && !readOnly && (
            <MaybeTooltip reason={postBlocker}>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                disabled={isBusy || !!postBlocker}
                onClick={() => { setPostDate(todayIso()); setPostDialog({ advance: false }); }}
              >
                <Printer className="h-4 w-4" />Marquer posté
              </Button>
            </MaybeTooltip>
          )}
          {isPosted && (
            <Badge variant="secondary" className="gap-1 bg-emerald-100 text-emerald-700 border-emerald-200">
              Posté le {new Date(postedOn!).toLocaleDateString("fr-FR")}
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

          {transitionsBar}
        </div>
      </div>

      {/* Courriel d'un courrier à l'initiative : ce qui part, et si quelque chose peut partir. */}
      {kind === "initiative" && channel === "email" && workflow && !isSent && (
        workflow.states.some((s) => s.is_send) ? (
          <p className="shrink-0 text-xs text-muted-foreground">
            Le courriel partira à {senderEmail ?? "votre destinataire"} au passage de l'étape d'envoi, avec les documents
            du courrier en pièces jointes (10 au plus, 10 Mo en tout).
          </p>
        ) : (
          <p className="flex shrink-0 items-center gap-1.5 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs">
            <Send className="h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />
            Le workflow de réponse de « {currentService.name} » n'a pas d'étape d'envoi : ce courriel ne pourra pas partir,
            ni être clos. Un administrateur doit en marquer une « envoi », ou passez en courrier postal.
          </p>
        )
      )}

      {/* Assistant sur consigne — courrier à l'initiative */}
      {kind === "initiative" && !editorDisabled && reply && (
        <InitiativeAssistantPanel assistant={assistant} busy={isBusy} />
      )}
      <InitiativeOverwriteDialog assistant={assistant} />

      <PostDeclarationDialog
        open={!!postDialog}
        onClose={() => setPostDialog(null)}
        date={postDate}
        onDateChange={setPostDate}
        minDate={reply?.created_at?.slice(0, 10)}
        onPrint={() => void handlePrintPdf(hasTemplate)}
        onConfirm={() => postDialog && doPost.mutate({ advance: postDialog.advance, postedOn: postDate })}
        pending={doPost.isPending}
      />

      {/* Assistant IA */}
      {!body && !editorDisabled && assistant.canDraft && (
        <ReplyAssistantPanel assistant={assistant} receivedAt={receivedAt} />
      )}

      {/* Améliorer mon message : la langue, jamais le sens. Annulable tant
          que l'agent n'a pas retouché le texte amélioré. */}
      {!editorDisabled && assistant.courierId && visibleText(body) !== "" && (
        <ImproveBar assistant={assistant} busy={isBusy} />
      )}

      {/* Visa : attente, commentaire, trace */}
      {isVisaState && !activeVisa && reply && (
        <VisaWaitingNotice
          designated={designatedViseur}
          noViseur={serviceViseurs.length === 0}
          serviceName={currentService.name}
          canVisa={currentUserIsViseur && !readOnly}
          currentUserId={currentUserId}
          comment={visaComment}
          onCommentChange={setVisaComment}
          busy={isBusy}
        />
      )}
      {replyVisas.length > 0 && <ReplyVisaTrail visas={replyVisas} className="shrink-0" />}

      {/* Figé par un visa déjà donné : on dit pourquoi, et comment rouvrir. */}
      {frozenByVisa && !isVisaState && !isFinal && !isSigned && (
        <p className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
          <Lock className="h-3 w-3 shrink-0" aria-hidden="true" />
          {words.frozen}
        </p>
      )}

      {/* Objet : celui du courriel envoyé et de la ligne « Objet » de la lettre. */}
      <div className="flex shrink-0 items-center gap-2">
        <label htmlFor="reply-subject" className="shrink-0 text-sm font-medium text-muted-foreground">
          Objet
        </label>
        <Input
          id="reply-subject"
          value={subject}
          onChange={(e) => { setSubject(e.target.value); setDirty(true); }}
          placeholder={defaultSubject}
          maxLength={200}
          disabled={editorDisabled || assistant.isDrafting || assistant.isImproving}
          className="h-9 text-sm"
        />
      </div>

      {/* Éditeur */}
      <RichTextEditor
        value={body}
        onChange={(html) => { setBody(html); setDirty(true); }}
        placeholder={
          channel === "email"
            ? words.emailPlaceholder(senderEmail)
            : words.paperPlaceholder
        }
        disabled={editorDisabled || assistant.isImproving}
        minHeight={220}
        className="flex-1 min-h-[220px]"
      />

      {/* Rappel des mentions de l'art. R112-5 CRPA, que l'assistant IA reçoit aussi. */}
      {!readOnly && kind === "reply" && (
        <AcknowledgmentChecklist
          ack={assistant.ackDetails}
          receivedAt={receivedAt}
          service={{
            name: currentService.name,
            address: currentService.address ?? null,
            email: currentService.email ?? null,
            phone: currentService.phone ?? null,
          }}
          highlighted={assistant.responseType === ACKNOWLEDGMENT_TYPE}
          className="shrink-0"
        />
      )}

    </div>
  );
}
