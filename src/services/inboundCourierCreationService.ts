// Création d'un courrier reçu saisi par un agent (dialogue « Nouveau courrier ») :
// expéditeur au référentiel, courrier, participants, pièces, analyse, drapeau
// confidentiel — dans cet ordre, pour les raisons notées à chaque étape.

import { supabase } from "@/integrations/supabase/client";
import { createCourier, setCourierConfidential } from "@/services/courierService";
import { addParticipant } from "@/services/courierParticipantService";
import { storage } from "@/services/storageService";
import {
  recordPreCreationAnalysis,
  type ExtractCourierInfoResult,
  type SuggestedSender,
} from "@/services/courierAnalysisService";
import { enqueueCourierAnalysis } from "@/services/courierAnalysisJobService";
import {
  createSenderContact,
  type SocleContact,
  type SocleContactCivility,
} from "@/services/socleContactService";
import type { CourierChannel } from "@/types/courier";

export interface InboundCourierInput {
  organizationId: string;
  subject: string;
  channel: CourierChannel;
  /** Date de réception choisie, `YYYY-MM-DD`. */
  receivedOn: string;
  bodyText: string;
  tags: string[];
  /** Organisation gestionnaire ; sans elle, le courrier attend dans la boîte aux lettres. */
  service: { id: string; name: string; workflow_id: string | null } | null;
  /** Contact du référentiel retenu comme expéditeur. */
  senderContact: SocleContact | null;
  /** Expéditeur lu par l'analyse, à créer au référentiel faute de contact retenu. */
  senderToCreate: { sender: SuggestedSender; civility: SocleContactCivility } | null;
  recipientContact: SocleContact | null;
  recipientName: string;
  files: File[];
  /** Analyse faite à la saisie, et les pièces qu'elle a lues. */
  preAnalysis: { result: ExtractCourierInfoResult; files: File[] } | null;
  confidential: boolean;
}

export interface InboundCourierCreated {
  courierId: string;
  uploaded: number;
  total: number;
  /** Pièces refusées, avec le motif — la création, elle, a réussi. */
  uploadFailures: { name: string; message: string }[];
}

/**
 * Date de réception : aujourd'hui → l'heure courante, pour se ranger parmi
 * les courriers récents ; un autre jour → midi heure locale, pour ne pas
 * changer de jour en passant en UTC.
 */
export function receivedAtIso(receivedOn: string, now: Date = new Date()): string {
  const today = now.toISOString().slice(0, 10);
  return receivedOn === today ? now.toISOString() : new Date(`${receivedOn}T12:00:00`).toISOString();
}

export async function createInboundCourier(input: InboundCourierInput): Promise<InboundCourierCreated> {
  const { organizationId, service } = input;

  let initialStateId: string | null = null;
  if (service?.workflow_id) {
    const { data, error } = await supabase
      .from("workflow_states")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("workflow_id", service.workflow_id)
      .eq("is_initial", true)
      .maybeSingle();
    if (error) throw error;
    initialStateId = data?.id ?? null;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Fiche créée AVANT le courrier : si le référentiel la refuse, rien n'est
  // créé et l'agent corrige, plutôt qu'un courrier sans expéditeur.
  const sender =
    input.senderContact ??
    (input.senderToCreate
      ? await createSenderContact(organizationId, input.senderToCreate.civility, input.senderToCreate.sender)
      : null);

  const { data: courier, error: cErr } = await createCourier({
    organization_id: organizationId,
    direction: "inbound",
    channel: input.channel,
    subject: input.subject.trim(),
    received_at: receivedAtIso(input.receivedOn),
    assigned_service: service?.name ?? null,
    socle_organization_id: service?.id ?? null,
    workflow_state_id: initialStateId,
    metadata: {
      tags: input.tags,
      socle_organization_id: service?.id ?? null,
      ...(input.bodyText.trim() ? { body_text: input.bodyText.trim() } : {}),
    },
    created_by: user?.id ?? null,
  });
  if (cErr) throw cErr;
  if (!courier) throw new Error("Création échouée");

  if (sender) {
    await addParticipant({
      courier_id: courier.id,
      organization_id: organizationId,
      role: "sender",
      name: sender.display_name,
      first_name: sender.first_name,
      last_name: sender.last_name ?? sender.legal_name,
      email: sender.email,
      phone: sender.mobile_phone ?? sender.landline_phone,
      socle_contact_id: sender.id,
    });
  }
  if (input.recipientContact) {
    const r = input.recipientContact;
    await addParticipant({
      courier_id: courier.id,
      organization_id: organizationId,
      role: "recipient",
      name: r.display_name,
      first_name: r.first_name,
      last_name: r.last_name ?? r.legal_name,
      email: r.email,
      socle_contact_id: r.id,
    });
  } else if (input.recipientName.trim()) {
    await addParticipant({
      courier_id: courier.id,
      organization_id: organizationId,
      role: "recipient",
      name: input.recipientName.trim(),
      last_name: input.recipientName.trim(),
    });
  }

  // Pièces : au mieux, chaque refus est rapporté sans annuler la création.
  const uploadFailures: InboundCourierCreated["uploadFailures"] = [];
  for (const file of input.files) {
    try {
      await storage.upload(organizationId, courier.id, file, "attachment");
    } catch (err) {
      uploadFailures.push({ name: file.name, message: err instanceof Error ? err.message : "Erreur upload" });
    }
  }
  const uploaded = input.files.length - uploadFailures.length;

  // Analysé à la saisie : cette analyse — résumé, classement, actions
  // suggérées, organisation proposée — devient celle du courrier, sans en
  // relancer une seconde (OCR et IA payés deux fois jusqu'au 2026-10-14).
  // Écrite AVANT de rendre la main : la fiche ouverte ensuite la trouve, et
  // « Courrier entrant » range aussitôt le courrier. Si les pièces ont changé
  // depuis, ou si l'écriture échoue : analyse complète en file.
  const pre = input.preAnalysis;
  const sameFiles =
    !!pre && pre.files.length === input.files.length && pre.files.every((f, i) => f === input.files[i]);
  let analysisRecorded = false;
  if (pre && sameFiles) {
    try {
      await recordPreCreationAnalysis(organizationId, courier.id, pre.result);
      analysisRecorded = true;
    } catch (e) {
      console.error("Analyse de saisie non enregistrée, analyse complète en file :", e);
    }
  }
  if (pre && !analysisRecorded && uploaded > 0) {
    await enqueueCourierAnalysis(courier.id).catch((e) => {
      console.error("Enfilement de l'analyse post-création impossible:", e);
    });
  }

  // Le drapeau en DERNIER : posé à l'insertion, il cacherait aussitôt le
  // courrier au service courrier non habilité, et les écritures qui précèdent
  // (participants, pièces) échoueraient.
  if (input.confidential) await setCourierConfidential(courier.id, true);

  return { courierId: courier.id, uploaded, total: input.files.length, uploadFailures };
}
