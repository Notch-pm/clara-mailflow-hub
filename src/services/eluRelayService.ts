import { supabase } from "@/integrations/supabase/client";
import { relaySubject } from "@/lib/elu-relay";
import { enqueueCourierAnalysis } from "@/services/courierAnalysisJobService";
import { createNote } from "@/services/courierNoteService";
import { addParticipant } from "@/services/courierParticipantService";
import type { SocleContact } from "@/services/socleContactService";
import { storage } from "@/services/storageService";

export interface EluRelayInput {
  organizationId: string;
  /** L'usager — obligatoire, déjà choisi ou créé dans le référentiel du Socle. */
  contact: SocleContact;
  /** Ce que l'usager demande, tel que l'élu l'a recueilli. Obligatoire. */
  request: string;
  files: File[];
  internalComment?: string | null;
}

export interface EluRelayResult {
  courierId: string;
  /** Pièces refusées au dépôt (taille, réseau) : le courrier existe malgré tout. */
  failedFiles: { name: string; error: string }[];
  /** Le commentaire interne n'a pas pu être enregistré. */
  commentFailed: boolean;
}

/**
 * Crée un courrier « Relayé élu » depuis l'espace élu.
 *
 * Le courrier naît comme une saisie manuelle sans organisation gestionnaire :
 * il attend dans la boîte aux lettres que le service courrier l'oriente — l'élu
 * n'a pas à connaître l'organigramme. Seule la création du courrier peut
 * échouer bloquante ; pièces, commentaire et analyse sont des suites
 * best-effort, signalées sans défaire ce qui a été créé (l'usager ne doit pas
 * perdre sa demande parce qu'une photo était trop lourde).
 */
export async function createEluRelayedCourier(input: EluRelayInput): Promise<EluRelayResult> {
  const request = input.request.trim();
  if (!request) throw new Error("La requête de l'usager est obligatoire.");
  const { contact, organizationId } = input;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: courier, error } = await supabase
    .from("couriers")
    .insert({
      organization_id: organizationId,
      direction: "inbound",
      channel: "relaye_elu",
      subject: relaySubject(request),
      received_at: new Date().toISOString(),
      // Ni organisation ni état : la boîte aux lettres, comme une saisie agent.
      assigned_service: null,
      socle_organization_id: null,
      workflow_state_id: null,
      metadata: { body_text: request, relayed_by: user?.id ?? null },
      created_by: user?.id ?? null,
    })
    .select("id")
    .single();
  if (error) throw error;
  if (!courier) throw new Error("Création du courrier impossible.");

  // L'expéditeur : la fiche du Socle, recopiée comme le fait la saisie agent.
  await addParticipant({
    courier_id: courier.id,
    organization_id: organizationId,
    role: "sender",
    name: contact.display_name,
    first_name: contact.first_name,
    last_name: contact.last_name ?? contact.legal_name,
    email: contact.email,
    phone: contact.mobile_phone ?? contact.landline_phone,
    socle_contact_id: contact.id,
  });

  // L'élu qui relaie : en copie, jamais expéditeur ni destinataire — la réponse
  // part à l'usager (send-courier-reply ne lit que `sender`/`recipient`).
  // Best-effort : son absence ne doit pas faire perdre la demande.
  if (user) {
    try {
      const { data: profile } = await supabase
        .from("users")
        .select("first_name, last_name, email")
        .eq("id", user.id)
        .maybeSingle();
      const first = profile?.first_name ?? null;
      const last = profile?.last_name ?? null;
      const email = profile?.email ?? user.email ?? null;
      await addParticipant({
        courier_id: courier.id,
        organization_id: organizationId,
        role: "cc",
        name: [first, last].filter(Boolean).join(" ") || email,
        first_name: first,
        last_name: last,
        email,
        metadata: { relayed_by_elu: true, user_id: user.id },
      });
    } catch (err) {
      console.error("Ajout de l'élu aux participants impossible", err);
    }
  }

  const failedFiles: EluRelayResult["failedFiles"] = [];
  for (const file of input.files) {
    try {
      await storage.upload(organizationId, courier.id, file, "attachment");
    } catch (err) {
      failedFiles.push({ name: file.name, error: err instanceof Error ? err.message : "Envoi impossible" });
    }
  }

  let commentFailed = false;
  const comment = input.internalComment?.trim();
  if (comment) {
    try {
      await createNote(organizationId, courier.id, comment);
    } catch {
      commentFailed = true;
    }
  }

  // Analyse en file côté serveur : le résumé et la proposition de service
  // arrivent même si l'élu ferme l'application juste après l'envoi.
  try {
    await enqueueCourierAnalysis(courier.id, "full");
  } catch (err) {
    console.error("Mise en file de l'analyse impossible", err);
  }

  return { courierId: courier.id, failedFiles, commentFailed };
}
