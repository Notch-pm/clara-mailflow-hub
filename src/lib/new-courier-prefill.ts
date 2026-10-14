// Pré-remplissage de la saisie d'un courrier à partir de l'analyse IA
// (`extractCourierInfo`). Module pur : ce que l'analyse change dans le
// formulaire, et ce qu'on en dit à l'agent, sans rien toucher soi-même.
//
// Règle constante : l'analyse PROPOSE, elle n'écrase jamais une saisie de
// l'agent (titre, contenu, destinataire, organisation déjà choisis).

import { findSuggestedOrg } from "@/lib/service-suggestion";
import type { ExtractCourierInfoResult, SuggestedSender } from "@/services/courierAnalysisService";
import type { SocleContact, SocleContactCivility } from "@/services/socleContactService";
import type { SenderMatch } from "../../supabase/functions/_shared/senderMatchLogic";

/** Ce que l'agent a déjà saisi, et que l'analyse ne doit pas écraser. */
export interface PrefillCurrent {
  subject: string;
  bodyText: string;
  recipientName: string;
  serviceId: string;
  selectedTags: string[];
}

/** Ce que l'analyse a dit de l'organisation gestionnaire, y compris son silence. */
export interface ServiceHint {
  orgId: string | null;
  text: string;
}

/** Changements à appliquer au formulaire ; un champ absent reste tel quel. */
export interface PrefillPatch {
  subject?: string;
  bodyText?: string;
  recipientName?: string;
  serviceId?: string;
  serviceHint: ServiceHint;
  /** Tags à AJOUTER à la sélection. */
  addTags: string[];
  /** L'expéditeur lu (identité gardée pour créer sa fiche si besoin), ou null. */
  extractedSender: SuggestedSender | null;
  senderMatch: SenderMatch<SocleContact> | null;
  /** Contact reconnu à sélectionner ; `null` = aucun ; absent = ne pas toucher. */
  senderContact?: SocleContact | null;
  civility?: SocleContactCivility;
  /** Ce qui a été pré-rempli, pour le message à l'agent. */
  filled: string[];
}

export function prefillFromExtraction(
  result: ExtractCourierInfoResult,
  current: PrefillCurrent,
  orgs: readonly { id: string; name: string }[],
): PrefillPatch {
  const filled: string[] = [];
  const patch: Omit<PrefillPatch, "serviceHint" | "filled"> = {
    addTags: [],
    extractedSender: null,
    senderMatch: null,
  };

  if (result.suggested_subject?.trim() && !current.subject.trim()) {
    patch.subject = result.suggested_subject.trim();
    filled.push("titre");
  }

  // Texte lu par l'OCR, ou texte collé / dicté.
  if (result.extracted_text?.trim() && !current.bodyText.trim()) {
    patch.bodyText = result.extracted_text.trim();
    filled.push("contenu");
  }

  // Expéditeur : reconnu dans le référentiel (email, téléphone ou nom+prénom
  // identiques) → sélectionné ; sinon il sera créé. L'identité extraite est
  // gardée dans les deux cas, pour pouvoir créer une fiche si l'agent écarte
  // le contact reconnu.
  const s = result.sender;
  const senderFound = !!(s.first_name || s.last_name || s.email || s.phone);
  const match = result.sender_match ?? null;
  patch.senderMatch = match;
  patch.extractedSender = senderFound ? s : null;
  if (s.civility) patch.civility = s.civility;
  if (match?.status === "matched" && match.contact) {
    patch.senderContact = match.contact;
    filled.push("expéditeur reconnu");
  } else if (senderFound) {
    patch.senderContact = null;
    filled.push("expéditeur extrait");
  }

  if (result.recipient_name && !current.recipientName.trim()) {
    patch.recipientName = result.recipient_name;
    filled.push("destinataire");
  }

  // Organisation gestionnaire : la proposition est pré-sélectionnée (sans
  // écraser un choix de l'agent) et toujours expliquée, y compris son absence.
  // Se taire laissait croire à une panne.
  let serviceHint: ServiceHint;
  const suggestedOrg = findSuggestedOrg(result, orgs);
  if (suggestedOrg) {
    if (!current.serviceId) {
      patch.serviceId = suggestedOrg.id;
      filled.push("organisation gestionnaire");
    }
    const confidence = result.suggested_service_confidence;
    serviceHint = {
      orgId: suggestedOrg.id,
      text: [
        `Proposée par l'IA${confidence != null ? ` (confiance ${confidence} %)` : ""}.`,
        result.suggested_service_reason ?? "",
      ].filter(Boolean).join(" "),
    };
  } else {
    serviceHint = {
      orgId: null,
      text: `L'IA ne propose pas d'organisation. ${
        result.service_suggestion_note ?? "Le contenu ne relève clairement d'aucune organisation."
      }`,
    };
  }

  if (result.suggested_tag_names.length) {
    const existing = new Set(current.selectedTags.map((t) => t.toLowerCase()));
    patch.addTags = result.suggested_tag_names.filter((t) => !existing.has(t.toLowerCase()));
    if (patch.addTags.length) filled.push(`${patch.addTags.length} tag(s)`);
  }

  return { ...patch, serviceHint, filled };
}
