import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ACKNOWLEDGMENT_TYPE } from "../../../../supabase/functions/draft-reply/logic";
import type { AckDetails } from "../../../../supabase/functions/draft-reply/acknowledgment";
import { visibleText } from "../../../../supabase/functions/_shared/improveMessage";
import { draftOutbound, draftReply, improveReply } from "@/services/courierDraftService";

interface Args {
  organizationId: string;
  /** Le sortant édité, `null` tant qu'il n'est pas enregistré. */
  replyId: string | null;
  /** Le courrier reçu auquel il répond ; `null` pour un courrier à l'initiative. */
  parentCourierId: string | null;
  kind: "reply" | "initiative";
  body: string;
  subject: string;
  setBody: (html: string) => void;
  setSubject: (subject: string) => void;
  markDirty: () => void;
}

/**
 * L'assistant de rédaction d'un sortant : réponse par type (réponses à un
 * courrier reçu), rédaction sur consigne (courriers à l'initiative), et
 * « Améliorer mon message » — la langue, jamais le sens. Chaque proposition
 * reste annulable tant que l'agent ne l'a pas retouchée.
 */
export function useOutboundAssistant({
  organizationId,
  replyId,
  parentCourierId,
  kind,
  body,
  subject,
  setBody,
  setSubject,
  markDirty,
}: Args) {
  // Contexte de l'assistant : le courrier reçu pour une réponse ; le sortant
  // lui-même pour « Améliorer ».
  const courierId = parentCourierId ?? replyId;
  const canDraft = kind === "reply" && !!parentCourierId;

  const [panelOpen, setPanelOpen] = useState(false);
  const [responseType, setResponseType] = useState<string>("");
  const [instructions, setInstructions] = useState<string>("");
  const [ackDetails, setAckDetails] = useState<AckDetails>({});
  const [isDrafting, setIsDrafting] = useState(false);
  // Courrier à l'initiative : la consigne libre, et de quoi revenir en arrière.
  const [initiativePrompt, setInitiativePrompt] = useState("");
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const [beforeDraft, setBeforeDraft] = useState<{ html: string; subject: string; drafted: string } | null>(null);
  const [isImproving, setIsImproving] = useState(false);
  /** Le texte d'avant « Améliorer » — annulable tant que l'agent n'a rien retouché depuis. */
  const [beforeImprove, setBeforeImprove] = useState<{
    original: string;
    improved: string;
    originalSubject: string;
    improvedSubject: string;
  } | null>(null);

  useEffect(() => {
    setBeforeImprove(null);
  }, [replyId]);

  /** La consigne part avec le brouillon en cours : l'assistant l'améliore. */
  async function runInitiativeDraft() {
    if (!replyId) return;
    setConfirmOverwrite(false);
    setIsDrafting(true);
    try {
      const draft = await draftOutbound({
        outboundId: replyId,
        orgId: organizationId,
        prompt: initiativePrompt.trim(),
        currentSubject: subject.trim() || null,
        currentHtml: body,
      });
      setBeforeDraft({ html: body, subject, drafted: draft.html });
      setBody(draft.html);
      if (draft.subject) setSubject(draft.subject);
      markDirty();
      setBeforeImprove(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Rédaction impossible");
    } finally {
      setIsDrafting(false);
    }
  }

  function draftFromPrompt() {
    // Un texte déjà écrit ne se remplace pas sans le dire.
    if (visibleText(body) !== "") setConfirmOverwrite(true);
    else void runInitiativeDraft();
  }

  function undoInitiativeDraft() {
    if (!beforeDraft) return;
    setBody(beforeDraft.html);
    setSubject(beforeDraft.subject);
    markDirty();
    setBeforeDraft(null);
  }

  async function draftByType() {
    if (!responseType) { toast.error("Sélectionnez un type de réponse."); return; }
    if (!canDraft || !parentCourierId) return;
    setIsDrafting(true);
    try {
      const draft = await draftReply({
        courierId: parentCourierId,
        orgId: organizationId,
        responseType,
        additionalInstructions: instructions.trim() || undefined,
        currentSubject: subject.trim() || null,
        acknowledgment: responseType === ACKNOWLEDGMENT_TYPE ? ackDetails : undefined,
      });
      setBody(draft.html);
      // L'objet proposé (ou corrigé) remplace celui de l'éditeur ; sans
      // proposition exploitable, on garde ce qui y était.
      if (draft.subject) setSubject(draft.subject);
      markDirty();
      setPanelOpen(false);
      setBeforeImprove(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Rédaction impossible");
    } finally {
      setIsDrafting(false);
    }
  }

  async function improve() {
    if (!courierId) return;
    const original = body;
    const originalSubject = subject;
    setIsImproving(true);
    try {
      const result = await improveReply({
        courierId,
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
      markDirty();
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
    markDirty();
    setBeforeImprove(null);
  }

  return {
    courierId,
    canDraft,
    panelOpen,
    setPanelOpen,
    responseType,
    setResponseType,
    instructions,
    setInstructions,
    ackDetails,
    setAckDetails,
    isDrafting,
    isImproving,
    initiativePrompt,
    setInitiativePrompt,
    confirmOverwrite,
    setConfirmOverwrite,
    /** « Annuler la rédaction » : seulement tant que le texte proposé est intact. */
    canUndoDraft: !!beforeDraft && beforeDraft.drafted === body,
    /** « Annuler l'amélioration » : idem, objet compris. */
    canUndoImprove: !!beforeImprove && beforeImprove.improved === body && beforeImprove.improvedSubject === subject,
    runInitiativeDraft,
    draftFromPrompt,
    undoInitiativeDraft,
    draftByType,
    improve,
    undoImprove,
  };
}

export type OutboundAssistant = ReturnType<typeof useOutboundAssistant>;
