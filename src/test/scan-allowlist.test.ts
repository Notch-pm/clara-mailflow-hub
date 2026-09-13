import { describe, it, expect } from "vitest";
import {
  isInboundSenderAccepted,
  describeRejectedScanSenders,
  scanInboxAcceptsNothing,
} from "../../supabase/functions/fetch-inbound-emails/logic";

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

// Le fail-closed ci-dessus est correct, mais il était MUET : la relève renvoyait
// { ok: true, processed: 0 } et remettait last_error à null. Symptôme vécu le
// 2026-09-13 (boîte « Scanner Mairie » de SNA) : boîte verte, zéro courrier.
describe("visibilité du refus", () => {
  it("relève propre : rien à signaler (last_error doit redevenir null)", () => {
    expect(describeRejectedScanSenders([])).toBeNull();
  });

  it("nomme les expéditeurs refusés et compte les messages", () => {
    const msg = describeRejectedScanSenders([
      "pirate@exemple.fr",
      "PIRATE@exemple.fr",
      "autre@exemple.fr",
    ]);
    expect(msg).toContain("3 message(s)");
    expect(msg).toContain("pirate@exemple.fr");
    expect(msg).toContain("autre@exemple.fr");
    // dédoublonné malgré la casse
    expect(msg!.match(/pirate@exemple\.fr/g)).toHaveLength(1);
  });

  it("expéditeur illisible : signalé quand même", () => {
    expect(describeRejectedScanSenders([""])).toContain("expéditeur inconnu");
  });

  it("tronque au-delà de 3 adresses distinctes", () => {
    const msg = describeRejectedScanSenders(["a@x.fr", "b@x.fr", "c@x.fr", "d@x.fr"]);
    expect(msg).toContain("+1 autre(s)");
  });
});

// Le bouton « Tester » ne valide que le LOGIN : il doit malgré tout alerter
// quand la boîte, bien connectée, ne pourra rien accepter.
describe("scanInboxAcceptsNothing — boîte condamnée à tout refuser", () => {
  it("boîte IMAP normale : jamais concernée", () => {
    expect(scanInboxAcceptsNothing(false, null)).toBe(false);
    expect(scanInboxAcceptsNothing(false, [])).toBe(false);
  });

  it("boîte de numérisation sans allowlist exploitable", () => {
    expect(scanInboxAcceptsNothing(true, null)).toBe(true);
    expect(scanInboxAcceptsNothing(true, [])).toBe(true);
    expect(scanInboxAcceptsNothing(true, ["", "   "])).toBe(true);
  });

  it("boîte de numérisation correctement configurée", () => {
    expect(scanInboxAcceptsNothing(true, ["copieur@mairie.fr"])).toBe(false);
  });
});
