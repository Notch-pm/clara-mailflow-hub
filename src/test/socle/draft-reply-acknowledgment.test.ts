import { describe, expect, it } from "vitest";
import {
  ACK_MENTIONS,
  buildAckBlock,
  defaultImplicitDecisionDate,
  formatIsoDayFr,
  normalizeAckDetails,
  silenceStatement,
} from "../../../supabase/functions/draft-reply/acknowledgment";
import {
  ACKNOWLEDGMENT_TYPE,
  buildDraftUserPrompt,
  DRAFT_SYSTEM_PROMPT,
  RESPONSE_TYPES,
} from "../../../supabase/functions/draft-reply/logic";

const BASE = {
  responseType: ACKNOWLEDGMENT_TYPE,
  senderFullName: "Marie Dupont",
  senderFirstName: "Marie",
  senderLastName: "Dupont",
  subject: "Demande d'occupation du domaine public",
  orgName: "Commune de Saint-Aubin",
  bodyText: "Je sollicite une autorisation de terrasse.",
  receivedAtLabel: "12 octobre 2026",
};

const SERVICE = {
  name: "Service Urbanisme",
  address: "1 place de la Mairie\n35000 Saint-Aubin",
  email: "urbanisme@saint-aubin.fr",
  phone: "02 99 00 00 00",
};

describe("accusé de réception — la liste de l'art. R112-5", () => {
  it("couvre les quatre mentions, écran et prompt partageant la même liste", () => {
    expect(ACK_MENTIONS.map((m) => m.key)).toEqual(["dates", "service", "pieces", "silence"]);
    expect(RESPONSE_TYPES).toContain(ACKNOWLEDGMENT_TYPE);
  });

  it("impose au modèle de les reprendre toutes, sans deviner les trous", () => {
    expect(DRAFT_SYSTEM_PROMPT).toContain("MENTIONS OBLIGATOIRES (article R112-5");
    expect(DRAFT_SYSTEM_PROMPT).toContain("L232-3");
    expect(DRAFT_SYSTEM_PROMPT).toContain("se recopie telle quelle à sa place");
  });
});

describe("accusé de réception — bloc du prompt", () => {
  it("n'apparaît que pour un accusé de réception", () => {
    const ack = buildDraftUserPrompt({ ...BASE, assignedOrgContact: SERVICE });
    expect(ack).toContain("MENTIONS OBLIGATOIRES DE L'ACCUSÉ DE RÉCEPTION");
    const suivi = buildDraftUserPrompt({ ...BASE, responseType: "Suivi", assignedOrgContact: SERVICE });
    expect(suivi).not.toContain("MENTIONS OBLIGATOIRES DE L'ACCUSÉ DE RÉCEPTION");
  });

  it("donne la date de réception, la date de décision implicite et les coordonnées du service", () => {
    const block = buildAckBlock({
      details: { silence: "acceptation", implicitDecisionDate: "2026-12-12" },
      receivedAtLabel: "12 octobre 2026",
      service: SERVICE,
    });
    expect(block).toContain("Date de réception de la demande : 12 octobre 2026");
    expect(block).toContain("réputée acceptée : 12 décembre 2026");
    expect(block).toContain("Désignation : Service Urbanisme");
    expect(block).toContain("Adresse postale : 1 place de la Mairie, 35000 Saint-Aubin");
    expect(block).toContain("Adresse électronique : urbanisme@saint-aubin.fr");
    expect(block).toContain("Téléphone : 02 99 00 00 00");
    expect(block).toContain("Pièces manquantes : aucune signalée");
  });

  it("acceptation implicite : l'attestation de l'article L232-3", () => {
    const block = buildAckBlock({ details: { silence: "acceptation", implicitDecisionDate: "2026-12-12" }, service: SERVICE });
    expect(block).toContain("ACCEPTATION implicite");
    expect(block).toContain("attestation de cette décision implicite d'acceptation (article L232-3");
    expect(block).not.toContain("Télérecours");
  });

  it("rejet implicite : les délais et voies de recours", () => {
    const block = buildAckBlock({ details: { silence: "rejet", implicitDecisionDate: "2026-12-12" }, service: SERVICE });
    expect(block).toContain("REJET implicite");
    expect(block).toContain("dans un délai de deux mois à compter de cette date");
    expect(block).toContain("tribunal administratif");
    expect(block).not.toContain("L232-3");
  });

  it("marque chaque inconnue d'un [à compléter : …] au lieu de la laisser deviner", () => {
    const block = buildAckBlock({ details: {}, service: { name: "Service Urbanisme" } });
    expect(block).toContain("[à compléter : date de réception]");
    expect(block).toContain("[à compléter : date de naissance de la décision implicite]");
    expect(block).toContain("[à compléter : adresse postale du service]");
    expect(block).toContain("[à compléter : téléphone du service]");
    expect(block).toContain("[à compléter : acceptation ou rejet implicite]");
  });

  it("pièces manquantes : la liste, le délai, et le point de départ reporté (L114-5)", () => {
    const block = buildAckBlock({
      details: {
        silence: "rejet",
        implicitDecisionDate: "2026-12-12",
        missingPieces: "Plan de la terrasse\nAttestation d'assurance",
        missingPiecesDeadline: "15 jours",
      },
      service: SERVICE,
    });
    expect(block).toContain("   - Plan de la terrasse");
    expect(block).toContain("   - Attestation d'assurance");
    expect(block).toContain("Délai pour les produire : 15 jours");
    expect(block).toContain("ne court qu'à compter de la réception des pièces manquantes");
    expect(block).toContain("au terme de ce délai");
  });
});

describe("accusé de réception — saisie et dates", () => {
  it("relit ce qu'envoie le navigateur", () => {
    expect(normalizeAckDetails({ silence: "peut-être", implicitDecisionDate: "2026-02-30" })).toEqual({
      silence: null,
      implicitDecisionDate: null,
      missingPieces: null,
      missingPiecesDeadline: null,
    });
    expect(normalizeAckDetails(null)).toEqual({});
    expect(normalizeAckDetails({ silence: "rejet", implicitDecisionDate: "2026-12-12", missingPieces: "  " }))
      .toMatchObject({ silence: "rejet", implicitDecisionDate: "2026-12-12", missingPieces: null });
  });

  it("propose deux mois après la réception, ramenés au dernier jour du mois", () => {
    expect(defaultImplicitDecisionDate("2026-10-12T09:00:00Z")).toBe("2026-12-12");
    expect(defaultImplicitDecisionDate("2026-12-31T09:00:00Z")).toBe("2027-02-28");
    expect(defaultImplicitDecisionDate(null)).toBeNull();
  });

  it("formate une date sans décalage de fuseau", () => {
    expect(formatIsoDayFr("2026-12-01")).toBe("1 décembre 2026");
    expect(formatIsoDayFr("pas une date")).toBeNull();
  });

  it("compose les phrases types avec la date fournie", () => {
    expect(silenceStatement("acceptation", "12 décembre 2026")).toContain("au 12 décembre 2026, votre demande sera réputée acceptée");
    expect(silenceStatement("rejet", "12 décembre 2026")).toContain("au 12 décembre 2026, votre demande sera réputée rejetée");
  });
});
