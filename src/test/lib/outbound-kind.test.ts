import { describe, expect, it } from "vitest";
import { isOutboundSettled, outboundKind, outboundMetaLine, outboundRecipient } from "@/lib/outbound-kind";

const person = (role: string, name: string | null, socle_contact_id: string | null = null) => ({
  role,
  name,
  first_name: null,
  last_name: null,
  socle_contact_id,
});

describe("outboundKind", () => {
  it("une réponse a un courrier parent, un courrier à l'initiative n'en a pas", () => {
    expect(outboundKind("parent-1")).toBe("reply");
    expect(outboundKind(null)).toBe("initiative");
    expect(outboundKind(undefined)).toBe("initiative");
  });
});

describe("outboundRecipient", () => {
  it("prend le destinataire du sortant et sa fiche", () => {
    expect(outboundRecipient([person("recipient", "Jeanne Martin", "c-1")], [person("sender", "Autre", "c-2")])).toEqual({
      name: "Jeanne Martin",
      contactId: "c-1",
    });
  });

  it("retombe sur l'expéditeur du courrier reçu quand la réponse n'a pas de destinataire", () => {
    expect(outboundRecipient([], [person("sender", "Paul Durand", "c-2")])).toEqual({ name: "Paul Durand", contactId: "c-2" });
  });

  it("ne prête jamais à un destinataire la fiche d'une autre personne", () => {
    expect(outboundRecipient([person("recipient", "Jeanne Martin")], [person("sender", "Paul Durand", "c-2")])).toEqual({
      name: "Jeanne Martin",
      contactId: null,
    });
  });

  it("compose le nom depuis prénom et nom", () => {
    const p = { role: "recipient", name: null, first_name: "Jeanne", last_name: "Martin", socle_contact_id: null };
    expect(outboundRecipient([p], null)?.name).toBe("Jeanne Martin");
  });

  it("rend null sans personne identifiable", () => {
    expect(outboundRecipient(null, null)).toBeNull();
    expect(outboundRecipient([person("recipient", null)], null)).toBeNull();
  });
});

describe("outboundMetaLine", () => {
  it("ne parle de courrier reçu que pour une réponse", () => {
    const receivedAt = "2026-09-04T10:00:00Z";
    expect(outboundMetaLine({ kind: "reply", recipientName: "Jeanne Martin", receivedAt })).toBe(
      "À Jeanne Martin · courrier reçu le 04/09/2026",
    );
    expect(outboundMetaLine({ kind: "initiative", recipientName: "Jeanne Martin", receivedAt })).toBe("À Jeanne Martin");
    expect(outboundMetaLine({ kind: "initiative", recipientName: null, receivedAt: null })).toBeNull();
  });
});

describe("isOutboundSettled", () => {
  it("signé, envoyé ou posté : figé", () => {
    expect(isOutboundSettled({ signed_at: "2026-10-13T10:00:00Z" })).toBe(true);
    expect(isOutboundSettled({ sent_email_at: "2026-10-13T10:00:00Z" })).toBe(true);
    expect(isOutboundSettled({ posted_at: "2026-10-13" })).toBe(true);
  });
  it("brouillon : modifiable", () => {
    expect(isOutboundSettled({})).toBe(false);
    expect(isOutboundSettled(null)).toBe(false);
    expect(isOutboundSettled({ signed_at: null })).toBe(false);
  });
});
