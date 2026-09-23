// Résolution de l'expéditeur d'un brouillon à la confirmation de l'import en
// masse : contact du référentiel reconnu, fiche déjà créée pendant ce lot, ou
// nouvelle fiche créée dans le Socle.

import {
  createSenderContact,
  matchSender,
  type SocleContact,
} from "@/services/socleContactService";
import {
  isSameSender,
  type SenderIdentity,
} from "../../../../supabase/functions/_shared/senderMatchLogic";
import { linkedSenderContact, type DraftCourier } from "./types";

export interface CreatedSender {
  sender: SenderIdentity;
  contact: SocleContact;
}

/**
 * Contact à rattacher comme expéditeur. Lève une erreur si le référentiel est
 * injoignable ou refuse la création — l'appelant garde alors un participant
 * libre plutôt que de perdre le courrier.
 *
 * `created` est enrichi des fiches créées : un second courrier de la même
 * personne, inconnue au départ, se rattache à la fiche du premier.
 */
export async function resolveSenderContact(
  organizationId: string,
  draft: DraftCourier,
  sender: SenderIdentity,
  created: CreatedSender[],
): Promise<SocleContact> {
  // Rapprochement absent (référentiel muet à l'analyse) ou périmé : on le
  // refait plutôt que de conclure à un inconnu et de créer un doublon.
  const senderMatch = draft.senderMatch ?? (await matchSender(organizationId, sender));
  const linked = linkedSenderContact({ ...draft, senderMatch });
  if (linked) return linked;

  // Une fiche écartée par l'agent (« créer plutôt un nouveau contact ») ne
  // doit pas revenir par ce biais : seules les fiches de CE lot sont réutilisées.
  const already = created.find((c) => isSameSender(c.sender, sender));
  if (already) return already.contact;

  if (!draft.senderCivility) {
    throw new Error("Civilité manquante : le référentiel l'exige pour créer une personne.");
  }
  const contact = await createSenderContact(organizationId, draft.senderCivility, sender);
  created.push({ sender, contact });
  return contact;
}
