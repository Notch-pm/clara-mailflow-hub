import { approvalLabel } from "@/lib/approval-label";
import type { CourierChannel } from "@/types/courier";

/** Dit aussi OÙ ajouter l'adresse manquante : le courrier ou la fiche usager. */
export const NO_EMAIL_REASON =
  "Aucune adresse email : ni sur le courrier, ni sur la fiche de l'expéditeur dans le référentiel.";

/**
 * Le geste que porte la transition nominale « suivante » en quittant l'étape :
 * déclarer posté, viser, signer ou envoyer — `null` pour une simple transition.
 */
export type NextGesture = "post" | "visa" | "sign" | "send" | null;

export interface GestureContext {
  isVisaState: boolean;
  hasActiveVisa: boolean;
  isSignatureState: boolean;
  isSigned: boolean;
  isSendState: boolean;
  isSent: boolean;
  channel: CourierChannel;
  /** Courrier postal à l'initiative pas encore déclaré posté. */
  canDeclarePosted: boolean;
}

export function nextGesture(c: GestureContext): NextGesture {
  if (c.isSendState && c.channel === "paper" && c.canDeclarePosted) return "post";
  if (c.isVisaState && !c.hasActiveVisa) return "visa";
  if (c.isSignatureState && !c.isSigned) return "sign";
  if (c.isSendState && !c.isSent && c.channel === "email") return "send";
  return null;
}

export interface GestureRights {
  /** Ce qui empêche de déclarer posté (adresse postale incomplète…). */
  postBlocker: string | null;
  isViseur: boolean;
  isSignatory: boolean;
  hasSignatory: boolean;
  canEmail: boolean;
}

/** Pourquoi le bouton « suivant » est grisé, ou `null`. */
export function gestureBlocker(gesture: NextGesture, r: GestureRights): string | null {
  switch (gesture) {
    case "post":
      return r.postBlocker;
    case "visa":
      return r.isViseur ? null : "Vous n'êtes pas viseur de cette organisation.";
    case "sign":
      if (!r.isSignatory) return "Vous n'êtes pas le signataire désigné.";
      return r.hasSignatory ? null : "Sélectionnez un signataire.";
    case "send":
      return r.canEmail ? null : NO_EMAIL_REASON;
    default:
      return null;
  }
}

/** Libellé du bouton : le nom de la transition, précédé du geste quand il ne le dit pas. */
export function gestureLabel(gesture: NextGesture, transitionName: string, sending = false): string {
  switch (gesture) {
    case "post":
      return "Imprimer et marquer posté";
    case "visa":
      return approvalLabel("visa", transitionName);
    case "sign":
      return approvalLabel("sign", transitionName);
    case "send":
      return sending ? "Envoi…" : approvalLabel("send", transitionName);
    default:
      return transitionName;
  }
}
