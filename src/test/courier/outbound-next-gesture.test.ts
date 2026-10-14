import { describe, expect, it } from "vitest";
import {
  gestureBlocker,
  gestureLabel,
  nextGesture,
  NO_EMAIL_REASON,
  type GestureContext,
  type GestureRights,
} from "@/components/courier/outbound/nextGesture";

const PLAIN: GestureContext = {
  isVisaState: false,
  hasActiveVisa: false,
  isSignatureState: false,
  isSigned: false,
  isSendState: false,
  isSent: false,
  channel: "email",
  canDeclarePosted: false,
};

const ALLOWED: GestureRights = { postBlocker: null, isViseur: true, isSignatory: true, hasSignatory: true, canEmail: true };

describe("nextGesture", () => {
  it("simple transition hors des étapes de visa, signature et envoi", () => {
    expect(nextGesture(PLAIN)).toBeNull();
  });

  it("visa tant que l'étape n'est pas visée, plus rien ensuite", () => {
    expect(nextGesture({ ...PLAIN, isVisaState: true })).toBe("visa");
    expect(nextGesture({ ...PLAIN, isVisaState: true, hasActiveVisa: true })).toBeNull();
  });

  it("signature tant que la réponse n'est pas signée", () => {
    expect(nextGesture({ ...PLAIN, isSignatureState: true })).toBe("sign");
    expect(nextGesture({ ...PLAIN, isSignatureState: true, isSigned: true })).toBeNull();
  });

  it("étape d'envoi : courriel à envoyer, courrier postal à déclarer posté", () => {
    expect(nextGesture({ ...PLAIN, isSendState: true })).toBe("send");
    expect(nextGesture({ ...PLAIN, isSendState: true, isSent: true })).toBeNull();
    expect(nextGesture({ ...PLAIN, isSendState: true, channel: "paper", canDeclarePosted: true })).toBe("post");
    // Postal déjà déclaré : simple transition.
    expect(nextGesture({ ...PLAIN, isSendState: true, channel: "paper" })).toBeNull();
  });
});

describe("gestureBlocker", () => {
  it("rien ne bloque quand on a les droits", () => {
    for (const g of ["post", "visa", "sign", "send", null] as const) expect(gestureBlocker(g, ALLOWED)).toBeNull();
  });

  it("dit pourquoi le bouton est grisé", () => {
    expect(gestureBlocker("post", { ...ALLOWED, postBlocker: "Adresse incomplète" })).toBe("Adresse incomplète");
    expect(gestureBlocker("visa", { ...ALLOWED, isViseur: false })).toBe("Vous n'êtes pas viseur de cette organisation.");
    expect(gestureBlocker("sign", { ...ALLOWED, isSignatory: false })).toBe("Vous n'êtes pas le signataire désigné.");
    expect(gestureBlocker("sign", { ...ALLOWED, hasSignatory: false })).toBe("Sélectionnez un signataire.");
    expect(gestureBlocker("send", { ...ALLOWED, canEmail: false })).toBe(NO_EMAIL_REASON);
  });
});

describe("gestureLabel", () => {
  it("garde le nom de la transition, en signalant l'envoi en cours", () => {
    expect(gestureLabel(null, "Clore")).toBe("Clore");
    expect(gestureLabel("post", "Envoyer")).toBe("Imprimer et marquer posté");
    expect(gestureLabel("send", "Envoyer", true)).toBe("Envoi…");
  });
});
