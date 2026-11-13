import { describe, expect, it } from "vitest";
import {
  claraCourierUrl,
  irisNotifyBackoffMinutes,
  irisNotifyOutcome,
  irisReplyBodyHtml,
  irisReplyEventBody,
  irisReplyLetter,
  irisLetterText,
  parseIrisReplyPayload,
} from "../../../supabase/functions/_shared/irisReplyLogic";

const SUB = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";
const CONTACT = "33333333-3333-4333-8333-333333333333";
const REQ = "44444444-4444-4444-8444-444444444444";

const valid = {
  submission_id: SUB,
  socle_organization_id: ORG,
  socle_contact_id: CONTACT,
  channel: "paper",
  subject: " Réponse à votre demande ",
  body_text: "Madame,\n\nVotre demande est accordée.",
  iris_request: { id: REQ, reference: "2026-00042", url: `https://iris.edilumen.fr/demandes/${REQ}` },
  submitted_by: { name: "Agent Iris", email: "agent@x.fr" },
};

describe("parseIrisReplyPayload", () => {
  it("accepte un dépôt complet", () => {
    const r = parseIrisReplyPayload(valid);
    expect(r).toMatchObject({
      submissionId: SUB,
      socleOrganizationId: ORG,
      socleContactId: CONTACT,
      channel: "paper",
      subject: "Réponse à votre demande",
      irisRequest: { id: REQ, reference: "2026-00042" },
    });
  });

  it("refuse ce que le circuit du sortant ne peut pas porter", () => {
    expect(parseIrisReplyPayload({ ...valid, socle_contact_id: null })).toHaveProperty("error");
    expect(parseIrisReplyPayload({ ...valid, channel: "sms" })).toHaveProperty("error");
    expect(parseIrisReplyPayload({ ...valid, body_text: "   " })).toHaveProperty("error");
    expect(parseIrisReplyPayload({ ...valid, iris_request: { id: "x" } })).toHaveProperty("error");
    expect(parseIrisReplyPayload("x")).toHaveProperty("error");
  });

  it("n'accepte qu'une URL https pour la fiche Iris", () => {
    const r = parseIrisReplyPayload({ ...valid, iris_request: { ...valid.iris_request, url: "javascript:alert(1)" } });
    expect("error" in r ? null : r.irisRequest.url).toBeNull();
  });
});

describe("irisReplyBodyHtml", () => {
  it("un paragraphe par bloc, retours à la ligne gardés, tout échappé", () => {
    expect(irisReplyBodyHtml("Madame,\n\nLigne 1\nLigne 2\n\n<script>x</script>"))
      .toBe("<p>Madame,</p><p>Ligne 1<br>Ligne 2</p><p>&lt;script&gt;x&lt;/script&gt;</p>");
  });
});

describe("avis à Iris", () => {
  it("compose le corps de l'événement", () => {
    expect(irisReplyEventBody("c", "sent", "2026-11-12T10:00:00.000Z"))
      .toEqual({ courier_id: "c", event: "sent", occurred_at: "2026-11-12T10:00:00.000Z" });
    expect(irisReplyEventBody("c", "cancelled", null)).toEqual({ courier_id: "c", event: "cancelled" });
  });

  it("joint le courrier parti à l'avis sent seulement (contrat Iris 2.13.0)", () => {
    const letter = { channel: "email" as const, subject: "S", body: "B", recipient: null };
    expect(irisReplyEventBody("c", "sent", null, letter)).toEqual({ courier_id: "c", event: "sent", letter });
    expect(irisReplyEventBody("c", "cancelled", null, letter)).toEqual({ courier_id: "c", event: "cancelled" });
  });

  it("distingue livré, refus définitif et nouvel essai", () => {
    expect(irisNotifyOutcome(200)).toBe("delivered");
    expect(irisNotifyOutcome(409)).toBe("rejected");
    expect(irisNotifyOutcome(404)).toBe("rejected");
    expect(irisNotifyOutcome(401)).toBe("retry");
    expect(irisNotifyOutcome(503)).toBe("retry");
    expect(irisNotifyOutcome(null)).toBe("retry");
  });

  it("espace les essais", () => {
    expect([0, 1, 2, 3, 4, 5, 20].map(irisNotifyBackoffMinutes)).toEqual([1, 2, 5, 15, 30, 60, 60]);
  });

  it("lien de la fiche Clara en https seulement", () => {
    expect(claraCourierUrl("https://clara.edilumen.fr/", "abc")).toBe("https://clara.edilumen.fr/courrier/abc");
    expect(claraCourierUrl("http://localhost", "abc")).toBeNull();
  });
});

describe("le courrier parti, pour Iris (2.13.0)", () => {
  const html = '<p>Madame,</p><p>Votre projet est retenu&nbsp;: bravo &amp; merci.<br>Cordialement</p>'
    + '<p><img src="data:image/png;base64,AAAA"></p>';

  it("texte brut : paragraphes et sauts gardés, signature image écartée, entités décodées", () => {
    expect(irisLetterText(html)).toBe("Madame,\nVotre projet est retenu : bravo & merci.\nCordialement");
  });

  it("courriel : la marque d'envoi fait foi, destinataire = adresse", () => {
    expect(irisReplyLetter({
      channel: "paper", subject: "Réponse", metadata: { body_html: html, sent_email_at: "2026-11-13T08:31:12Z" },
      recipient: { email: "marie@example.org", name: "Marie Durand" },
    })).toMatchObject({ channel: "email", subject: "Réponse", recipient: "marie@example.org" });
  });

  it("papier : destinataire = nom ; texte brut en repli quand le HTML manque", () => {
    expect(irisReplyLetter({
      channel: "email", subject: "Réponse", metadata: { body_text: "Bonjour", posted_at: "2026-11-13T08:31:12Z" },
      recipient: { email: null, name: "Marie Durand" },
    })).toEqual({ channel: "paper", subject: "Réponse", body: "Bonjour", recipient: "Marie Durand" });
  });

  it("rien d'exploitable : pas de letter (l'avis part sans trace plutôt que refusé)", () => {
    expect(irisReplyLetter({ channel: "email", subject: "S", metadata: {}, recipient: null })).toBeNull();
  });
});
