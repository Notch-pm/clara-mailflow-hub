import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Send, Save, Lock, PenLine, X, ArrowLeft, Printer, ChevronDown, Sparkles, Undo2, WandSparkles, Stamp } from "lucide-react";
import { toast } from "sonner";
import { edgeError } from "@/lib/edge-error";
import { ACKNOWLEDGMENT_TYPE, RESPONSE_TYPES } from "../../../../supabase/functions/draft-reply/logic";
import type { AckDetails } from "../../../../supabase/functions/draft-reply/acknowledgment";
import { AcknowledgmentChecklist, AcknowledgmentFields } from "../AcknowledgmentMentions";
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
import { isContentFrozenByVisa, isFreeExitFromVisa } from "@/lib/reply-visa";
import { Input } from "@/components/ui/input";
import { appendSignature, buildSignatureBlock } from "@/lib/reply-signature";
import { useAuth } from "@/contexts/AuthContext";
import { printReply, buildContactBlock } from "@/utils/printReply";
import { getOrgHtmlTemplate } from "@/services/templateService";
import { draftReply, improveReply } from "@/services/courierDraftService";
import { visibleText } from "../../../../supabase/functions/_shared/improveMessage";
import { Textarea } from "@/components/ui/textarea";
import type { CourierChannel, CourierParticipant } from "@/types/courier";
import { cn } from "@/lib/utils";
import { approvalLabel } from "@/lib/approval-label";
import { eventAnchor } from "@/lib/courier-events";

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

/** Dit aussi OÙ ajouter l'adresse manquante : le courrier ou la fiche usager. */
const NO_EMAIL_REASON =
  "Aucune adresse email : ni sur le courrier, ni sur la fiche de l'expéditeur dans le référentiel.";

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
}: OutboundEditorProps) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const currentUserId = user?.id ?? null;
  const senderEmail = recipientEmail?.trim() || null;
  const canEmail = !!senderEmail;
  const words = WORDING[kind];
  // Contexte de l'assistant : le courrier reçu pour une réponse ; le sortant
  // lui-même pour « Améliorer » (la langue, jamais le sens).
  const aiCourierId = parentCourierId ?? reply?.id ?? null;
  const canDraft = kind === "reply" && !!parentCourierId;

  // ─── Organization (for merge tags) ──────────────────────────────────
  // Les coordonnées propres de Clara sont souvent vides : depuis la bascule vers
  // le référentiel, l'adresse d'une collectivité y est saisie une fois pour
  // toute la gamme (`socle_organizations.address`, en texte libre). On relit
  // donc la ligne du référentiel correspondant au tenant et on s'en sert EN
  // REPLI — les colonnes de Clara, si elles sont remplies, restent prioritaires.
  // Sans ce repli, « Organisation (avec adresse) » n'imprimait que le nom pour
  // toute collectivité n'ayant jamais ressaisi son adresse dans Clara.
  const { data: organization } = useQuery({
    queryKey: ["org-coordinates", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organizations")
        .select("name, address_street, address_complement, address_postal_code, address_city, phone, website, contact_email, socle_org_id")
        .eq("id", organizationId)
        .single();
      if (error) throw error;
      const org = data as {
        name: string;
        address_street: string | null;
        address_complement: string | null;
        address_postal_code: string | null;
        address_city: string | null;
        phone: string | null;
        website: string | null;
        contact_email: string | null;
        socle_org_id: string | null;
      };
      if (!org.socle_org_id) return org;

      const { data: ref } = await supabase
        .from("socle_organizations")
        .select("address, phone, email")
        .eq("organization_id", organizationId)
        .eq("socle_id", org.socle_org_id)
        .maybeSingle();
      const referentiel = ref as { address: string | null; phone: string | null; email: string | null } | null;
      return {
        ...org,
        address: referentiel?.address ?? null,
        phone: org.phone ?? referentiel?.phone ?? null,
        contact_email: org.contact_email ?? referentiel?.email ?? null,
      };
    },
    enabled: !!organizationId,
  });

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

  // ─── AI assistant state ─────────────────────────────────────────────
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [aiResponseType, setAiResponseType] = useState<string>("");
  const [aiInstructions, setAiInstructions] = useState<string>("");
  const [ackDetails, setAckDetails] = useState<AckDetails>({});
  const [isDrafting, setIsDrafting] = useState(false);
  const [isImproving, setIsImproving] = useState(false);
  /** Le texte d'avant « Améliorer » — annulable tant que l'agent n'a rien retouché depuis. */
  const [beforeImprove, setBeforeImprove] = useState<{
    original: string;
    improved: string;
    originalSubject: string;
    improvedSubject: string;
  } | null>(null);

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
    setBeforeImprove(null);
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

  const isBusy = saveDraft.isPending || doUnsign.isPending ||
    doTransition.isPending || isPrintingWithTemplate ||
    doSignAndAdvance.isPending || doSendAndAdvance.isPending || isImproving ||
    setViseur.isPending || doVisaAndAdvance.isPending;

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

  const printArgs = {
    bodyHtml: body,
    subject: subject.trim() || reply?.subject || defaultSubject,
    senderName: sender
      ? `${sender.first_name ?? ""} ${sender.last_name ?? ""}`.trim() || sender.name || null
      : null,
    senderFirstName: sender?.first_name ?? null,
    senderLastName: sender?.last_name ?? null,
    // L'usager du courrier : son adresse est en texte libre sur le participant,
    // pas décomposée comme celle d'une organisation.
    senderCompleteHtml: sender
      ? buildContactBlock(
          `${sender.first_name ?? ""} ${sender.last_name ?? ""}`.trim() || sender.name || null,
          {
            organization: sender.organization,
            address: sender.address,
            phone: sender.phone,
            email: senderEmail,
          },
        )
      : null,
    date: reply?.created_at ?? new Date().toISOString(),
    organizationName: organization?.name ?? null,
    organizationCompleteHtml: organization ? buildContactBlock(organization.name, organization) : null,
    serviceName: currentService.name,
    serviceCompleteHtml: buildContactBlock(currentService.name, currentService),
  };

  async function handleDraft() {
    if (!aiResponseType) { toast.error("Sélectionnez un type de réponse."); return; }
    if (!canDraft || !parentCourierId) return;
    setIsDrafting(true);
    try {
      const draft = await draftReply({
        courierId: parentCourierId,
        orgId: organizationId,
        responseType: aiResponseType,
        additionalInstructions: aiInstructions.trim() || undefined,
        currentSubject: subject.trim() || null,
        acknowledgment: aiResponseType === ACKNOWLEDGMENT_TYPE ? ackDetails : undefined,
      });
      setBody(draft.html);
      // L'objet proposé (ou corrigé) remplace celui de l'éditeur ; sans
      // proposition exploitable, on garde ce qui y était.
      if (draft.subject) setSubject(draft.subject);
      setDirty(true);
      setAiPanelOpen(false);
      setBeforeImprove(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Rédaction impossible");
    } finally {
      setIsDrafting(false);
    }
  }

  async function handleImprove() {
    if (!aiCourierId) return;
    const original = body;
    const originalSubject = subject;
    setIsImproving(true);
    try {
      const result = await improveReply({
        courierId: aiCourierId,
        orgId: organizationId,
        html: original,
        subject: originalSubject.trim() || null,
      });
      const improved = result.html;
      const improvedSubject = result.subject ?? originalSubject;
      if (improved === original && improvedSubject === originalSubject) {
        toast.info("Aucune correction à apporter.");
        return;
      }
      setBody(improved);
      setSubject(improvedSubject);
      setDirty(true);
      setBeforeImprove({ original, improved, originalSubject, improvedSubject });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Amélioration impossible");
    } finally {
      setIsImproving(false);
    }
  }

  function undoImprove() {
    if (!beforeImprove) return;
    setBody(beforeImprove.original);
    setSubject(beforeImprove.originalSubject);
    setDirty(true);
    setBeforeImprove(null);
  }

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

  const renderTransitions = () => {
    if (outgoingTransitions.length === 0) {
      return !isFinal
        ? <span className="text-xs text-muted-foreground italic">Aucune transition définie.</span>
        : null;
    }

    const nextEntry = outgoingTransitions.find(({ transition }) => transition.kind === "next");
    const prevEntry = outgoingTransitions.find(({ transition }) => transition.kind === "previous");
    const nominalIds = new Set([nextEntry?.transition.id, prevEntry?.transition.id].filter(Boolean));
    // Étape de visa pas encore visée : seules les sorties que la base laisse
    // passer sans visa (retour, abandon, renvoi pour correction) — les autres
    // finiraient sur un refus serveur.
    const others = outgoingTransitions.filter(
      ({ transition, target }) =>
        !nominalIds.has(transition.id) &&
        (!isVisaState ||
          !!activeVisa ||
          isFreeExitFromVisa(
            { kind: (transition.kind ?? null) as "next" | "previous" | null, target },
            currentState && workflow ? { visaStateId: currentState.id, transitions: workflow.transitions } : undefined,
          )),
    );

    const runTransition = (target: { id: string; name: string; category: string | null; is_final?: boolean | null }) => {
      doTransition.mutate(target);
    };

    // The "next" nominal transition implicitly performs the signature / send
    // action when leaving a signature- or send-state.
    const nextRequiresVisa = !!nextEntry && isVisaState && !activeVisa;
    const nextRequiresSign = !!nextEntry && isSignatureState && !isSigned;
    const nextRequiresSend = !!nextEntry && isSendState && !isSent && channel === "email";
    const nextDisabledReason = nextRequiresVisa
      ? (!currentUserIsViseur ? "Vous n'êtes pas viseur de cette organisation." : null)
      : nextRequiresSign
      ? (!currentUserIsSignatory
          ? "Vous n'êtes pas le signataire désigné."
          : !signatoryId
            ? "Sélectionnez un signataire."
            : null)
      : nextRequiresSend
        ? (!canEmail ? NO_EMAIL_REASON : null)
        : null;

    const onClickNext = () => {
      if (!nextEntry) return;
      if (nextRequiresVisa) {
        doVisaAndAdvance.mutate();
        return;
      }
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
      ? (nextRequiresVisa
          ? approvalLabel("visa", nextEntry.transition.name || nextEntry.target.name)
          : nextRequiresSign
          ? approvalLabel("sign", nextEntry.transition.name || nextEntry.target.name)
          : nextRequiresSend
            ? (doSendAndAdvance.isPending ? "Envoi…" : approvalLabel("send", nextEntry.transition.name || nextEntry.target.name))
            : (nextEntry.transition.name || nextEntry.target.name))
      : "";

    const nextIcon = nextRequiresVisa
      ? <Stamp className="h-3.5 w-3.5" />
      : nextRequiresSign
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
      {!body && !editorDisabled && canDraft && (
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
                  {RESPONSE_TYPES.map((type) => (
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

              {aiResponseType === ACKNOWLEDGMENT_TYPE && (
                <AcknowledgmentFields value={ackDetails} onChange={setAckDetails} receivedAt={receivedAt} />
              )}

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

      {/* Améliorer mon message : la langue, jamais le sens. Annulable tant
          que l'agent n'a pas retouché le texte amélioré. */}
      {!editorDisabled && aiCourierId && visibleText(body) !== "" && (
        <div className="flex flex-wrap items-center justify-end gap-2 shrink-0">
          {beforeImprove && beforeImprove.improved === body && beforeImprove.improvedSubject === subject && (
            <Button variant="ghost" size="sm" className="gap-1.5" onClick={undoImprove} disabled={isBusy}>
              <Undo2 className="h-3.5 w-3.5" />
              Annuler l'amélioration
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleImprove}
            disabled={isBusy || isDrafting}
            className="gap-1.5 border-violet-300 text-violet-700 hover:bg-violet-50 hover:text-violet-800"
          >
            <WandSparkles className="h-3.5 w-3.5" />
            {isImproving ? "Relecture…" : "Améliorer mon message"}
          </Button>
        </div>
      )}

      {/* Visa : attente, commentaire, trace */}
      {isVisaState && !activeVisa && reply && (
        <div className="shrink-0 space-y-2 rounded-md border border-warning/40 bg-warning/5 px-3 py-2">
          <p className="flex items-center gap-2 text-sm">
            <Stamp className="h-4 w-4 shrink-0 text-warning" />
            {designatedViseur
              ? <>En attente du visa de <span className="font-medium">{visaPersonName(designatedViseur)}</span> (ou d'un autre viseur de l'organisation).</>
              : <>En attente du visa d'un viseur de l'organisation.</>}
          </p>
          {serviceViseurs.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Aucun viseur n'est rattaché à l'organisation « {currentService.name} » : un administrateur doit en associer un.
            </p>
          )}
          {currentUserIsViseur && !readOnly && (
            <>
              {designatedViseur && designatedViseur.id !== currentUserId && (
                <p className="text-xs text-muted-foreground">
                  Vous visez à la place de {visaPersonName(designatedViseur)}.
                </p>
              )}
              <Input
                value={visaComment}
                onChange={(e) => setVisaComment(e.target.value)}
                placeholder="Commentaire de visa (facultatif)"
                maxLength={500}
                className="h-8 text-sm"
                disabled={isBusy}
              />
            </>
          )}
        </div>
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
          disabled={editorDisabled || isDrafting || isImproving}
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
        disabled={editorDisabled || isImproving}
        minHeight={220}
        className="flex-1 min-h-[220px]"
      />

      {/* Rappel des mentions de l'art. R112-5 CRPA, que l'assistant IA reçoit aussi. */}
      {!readOnly && kind === "reply" && (
        <AcknowledgmentChecklist
          ack={ackDetails}
          receivedAt={receivedAt}
          service={{
            name: currentService.name,
            address: currentService.address ?? null,
            email: currentService.email ?? null,
            phone: currentService.phone ?? null,
          }}
          highlighted={aiResponseType === ACKNOWLEDGMENT_TYPE}
          className="shrink-0"
        />
      )}

    </div>
  );
}
