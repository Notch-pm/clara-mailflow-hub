import { describe, it, expect } from "vitest";
import { isInboundSenderAccepted } from "../../supabase/functions/fetch-inbound-emails/logic";

// Garantit le comportement FAIL-CLOSED de la boîte de numérisation : sans allowlist
// configurée, une boîte de scan ne laisse RIEN entrer (sinon injection de courriers
// par un tiers connaissant l'adresse). Une boîte IMAP normale n'est jamais filtrée.

describe("isInboundSenderAccepted — allowlist boîte de numérisation", () => {
  it("boîte IMAP normale : jamais filtrée (allowlist ignorée)", () => {
    expect(isInboundSenderAccepted(false, null, "n-importe-qui@exemple.fr")).toBe(true);
    expect(isInboundSenderAccepted(false, [], "n-importe-qui@exemple.fr")).toBe(true);
    expect(isInboundSenderAccepted(false, ["copieur@mairie.fr"], "autre@exemple.fr")).toBe(true);
  });

  describe("boîte de scan (fail-closed)", () => {
    it("allowlist NULL → tout rejeté", () => {
      expect(isInboundSenderAccepted(true, null, "copieur@mairie.fr")).toBe(false);
    });

    it("allowlist vide [] → tout rejeté (le piège : vider n'ouvre pas)", () => {
      expect(isInboundSenderAccepted(true, [], "copieur@mairie.fr")).toBe(false);
    });

    it("allowlist ne contenant que du blanc → tout rejeté", () => {
      expect(isInboundSenderAccepted(true, ["", "   "], "copieur@mairie.fr")).toBe(false);
    });

    it("expéditeur autorisé → accepté", () => {
      expect(isInboundSenderAccepted(true, ["copieur@mairie.fr"], "copieur@mairie.fr")).toBe(true);
    });

    it("expéditeur non listé → rejeté", () => {
      expect(isInboundSenderAccepted(true, ["copieur@mairie.fr"], "pirate@exemple.fr")).toBe(false);
    });

    it("comparaison insensible à la casse et aux espaces", () => {
      expect(isInboundSenderAccepted(true, ["  Copieur@Mairie.FR "], "COPIEUR@mairie.fr")).toBe(true);
    });

    it("expéditeur inconnu (null / vide) → rejeté", () => {
      expect(isInboundSenderAccepted(true, ["copieur@mairie.fr"], null)).toBe(false);
      expect(isInboundSenderAccepted(true, ["copieur@mairie.fr"], "")).toBe(false);
    });

    it("plusieurs expéditeurs autorisés → chacun accepté", () => {
      const allow = ["copieur1@mairie.fr", "copieur2@mairie.fr"];
      expect(isInboundSenderAccepted(true, allow, "copieur2@mairie.fr")).toBe(true);
      expect(isInboundSenderAccepted(true, allow, "copieur3@mairie.fr")).toBe(false);
    });
  });
});
