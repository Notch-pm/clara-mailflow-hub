import { describe, expect, it } from "vitest";
import { prefillFromExtraction, type PrefillCurrent } from "@/lib/new-courier-prefill";
import { receivedAtIso } from "@/services/inboundCourierCreationService";
import type { ExtractCourierInfoResult } from "@/services/courierAnalysisService";
import type { SocleContact } from "@/services/socleContactService";

const EMPTY: PrefillCurrent = { subject: "", bodyText: "", recipientName: "", serviceId: "", selectedTags: [] };
const ORGS = [
  { id: "org-voirie", name: "Voirie" },
  { id: "org-eau", name: "Eau" },
];

function result(overrides: Partial<ExtractCourierInfoResult> = {}): ExtractCourierInfoResult {
  return {
    suggested_subject: null,
    sender: { first_name: null, last_name: null, email: null, phone: null },
    recipient_name: null,
    suggested_service_name: null,
    suggested_tag_names: [],
    matched_contact: null,
    extracted_text: null,
    ...overrides,
  };
}

const contact = { id: "c-1", display_name: "Claire Moreau" } as SocleContact;

describe("prefillFromExtraction", () => {
  it("remplit les champs vides et dit lesquels", () => {
    const p = prefillFromExtraction(
      result({ suggested_subject: "  Nid-de-poule  ", extracted_text: "Bonjour", recipient_name: "Le maire" }),
      EMPTY,
      ORGS,
    );
    expect(p.subject).toBe("Nid-de-poule");
    expect(p.bodyText).toBe("Bonjour");
    expect(p.recipientName).toBe("Le maire");
    expect(p.filled).toEqual(["titre", "contenu", "destinataire"]);
  });

  it("n'écrase jamais une saisie de l'agent", () => {
    const p = prefillFromExtraction(
      result({ suggested_subject: "IA", extracted_text: "IA", recipient_name: "IA", suggested_socle_organization_id: "org-eau" }),
      { subject: "Agent", bodyText: "Agent", recipientName: "Agent", serviceId: "org-voirie", selectedTags: [] },
      ORGS,
    );
    expect(p.subject).toBeUndefined();
    expect(p.bodyText).toBeUndefined();
    expect(p.recipientName).toBeUndefined();
    expect(p.serviceId).toBeUndefined();
    // La raison reste dite, attachée à SA proposition.
    expect(p.serviceHint.orgId).toBe("org-eau");
  });

  it("organisation proposée : pré-sélectionnée et expliquée, confiance comprise", () => {
    const p = prefillFromExtraction(
      result({ suggested_socle_organization_id: "org-voirie", suggested_service_confidence: 82, suggested_service_reason: "Chaussée." }),
      EMPTY,
      ORGS,
    );
    expect(p.serviceId).toBe("org-voirie");
    expect(p.serviceHint).toEqual({ orgId: "org-voirie", text: "Proposée par l'IA (confiance 82 %). Chaussée." });
  });

  it("sans proposition, l'IA dit pourquoi plutôt que de se taire", () => {
    const p = prefillFromExtraction(result({ service_suggestion_note: "Courrier ambigu." }), EMPTY, ORGS);
    expect(p.serviceId).toBeUndefined();
    expect(p.serviceHint).toEqual({ orgId: null, text: "L'IA ne propose pas d'organisation. Courrier ambigu." });
    expect(prefillFromExtraction(result(), EMPTY, ORGS).serviceHint.text).toContain("ne relève clairement d'aucune");
  });

  it("expéditeur reconnu : sélectionné, identité lue gardée", () => {
    const sender = { first_name: "Claire", last_name: "Moreau", email: null, phone: null, civility: "madame" as const };
    const p = prefillFromExtraction(
      result({ sender, sender_match: { status: "matched", contact, mismatches: [] } as never }),
      EMPTY,
      ORGS,
    );
    expect(p.senderContact).toBe(contact);
    expect(p.extractedSender).toEqual(sender);
    expect(p.civility).toBe("madame");
    expect(p.filled).toContain("expéditeur reconnu");
  });

  it("expéditeur lu mais inconnu : contact vidé, à créer ; aucun expéditeur : rien touché", () => {
    const lu = prefillFromExtraction(result({ sender: { first_name: null, last_name: "Martin", email: null, phone: null } }), EMPTY, ORGS);
    expect(lu.senderContact).toBeNull();
    expect(lu.extractedSender?.last_name).toBe("Martin");
    expect(lu.filled).toContain("expéditeur extrait");

    const rien = prefillFromExtraction(result(), EMPTY, ORGS);
    expect(rien.senderContact).toBeUndefined();
    expect(rien.extractedSender).toBeNull();
  });

  it("tags : n'ajoute que les absents, sans tenir compte de la casse", () => {
    const p = prefillFromExtraction(
      result({ suggested_tag_names: ["Voirie", "urgent", "Mécontent"] }),
      { ...EMPTY, selectedTags: ["voirie"] },
      ORGS,
    );
    expect(p.addTags).toEqual(["urgent", "Mécontent"]);
    expect(p.filled).toContain("2 tag(s)");
  });
});

describe("receivedAtIso", () => {
  const now = new Date("2026-10-14T15:42:00Z");

  it("aujourd'hui : l'heure courante, pour se ranger parmi les récents", () => {
    expect(receivedAtIso("2026-10-14", now)).toBe(now.toISOString());
  });

  it("un autre jour : midi heure locale, pour ne pas changer de jour", () => {
    expect(receivedAtIso("2026-10-01", now)).toBe(new Date("2026-10-01T12:00:00").toISOString());
  });
});
