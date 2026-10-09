import { describe, expect, it } from "vitest";
import {
  distanceToAnchor,
  isUuid,
  pickTenant,
  PORTAL_BODY_MAX,
  portalFieldsFromForm,
  portalSenderParticipant,
  portalSubmissionError,
  safeStorageName,
  type PortalSubmissionFields,
} from "../../../supabase/functions/_shared/portalIntakeLogic";

const valid: PortalSubmissionFields = {
  subject: "Nid-de-poule rue des Lilas",
  body: "Bonjour, un nid-de-poule s'est formé devant le 12.",
  senderCategory: "citoyen",
  senderCivilite: "Mme",
  senderFirstName: "Anne",
  senderLastName: "Martin",
  senderEmail: "anne@example.org",
  senderPhone: null,
};

describe("portalFieldsFromForm", () => {
  it("lit les champs texte et ignore un fichier glissé à la place d'un texte", () => {
    const data: Record<string, unknown> = { subject: "Objet", body: new Blob(["x"]), sender_last_name: "Martin" };
    const f = portalFieldsFromForm((k) => data[k] ?? null);
    expect(f.subject).toBe("Objet");
    expect(f.body).toBeNull();
    expect(f.senderLastName).toBe("Martin");
  });
});

describe("portalSubmissionError — les mêmes règles pour l'iframe et pour Nora", () => {
  it("accepte un dépôt complet", () => {
    expect(portalSubmissionError(valid, [])).toBeNull();
  });

  it.each([
    [{ subject: "  " }, "Sujet obligatoire"],
    [{ body: "" }, "Message obligatoire"],
    [{ senderCategory: "syndic" }, "Catégorie invalide"],
    [{ senderFirstName: "" }, "Prénom obligatoire"],
    [{ senderLastName: null }, "Nom obligatoire"],
    [{ senderEmail: "", senderPhone: " " }, "Email ou téléphone obligatoire"],
  ])("refuse %o", (patch, message) => {
    expect(portalSubmissionError({ ...valid, ...patch }, [])).toBe(message);
  });

  it("n'exige pas de prénom d'une entreprise", () => {
    expect(portalSubmissionError({ ...valid, senderCategory: "entreprise", senderFirstName: null }, [])).toBeNull();
  });

  it("catégorie absente = citoyen", () => {
    expect(portalSubmissionError({ ...valid, senderCategory: null, senderFirstName: null }, [])).toBe("Prénom obligatoire");
  });

  it("limite le nombre et la taille des pièces", () => {
    const small = { name: "a.pdf", size: 10 };
    expect(portalSubmissionError(valid, [small, small, small, small])).toBe("Maximum 3 fichiers autorisés");
    expect(portalSubmissionError(valid, [{ name: "gros.pdf", size: 5 * 1024 * 1024 + 1 }])).toBe(
      'Le fichier "gros.pdf" dépasse la limite de 5 Mo',
    );
  });

  it("ne borne la longueur du message que si on le demande (Nora)", () => {
    const long = { ...valid, body: "x".repeat(PORTAL_BODY_MAX + 1) };
    expect(portalSubmissionError(long, [])).toBeNull();
    expect(portalSubmissionError(long, [], { bodyMax: PORTAL_BODY_MAX })).toMatch(/Message trop long/);
  });
});

describe("portalSenderParticipant — expéditeur brut, jamais rattaché", () => {
  it("citoyen : prénom + nom, civilité gardée", () => {
    expect(portalSenderParticipant(valid)).toMatchObject({
      role: "sender",
      name: "Anne Martin",
      first_name: "Anne",
      last_name: "Martin",
      email: "anne@example.org",
      phone: null,
      socle_contact_id: null,
      metadata: { category: "citoyen", civilite: "Mme" },
    });
  });

  it("association : raison sociale seule, ni prénom ni civilité", () => {
    const p = portalSenderParticipant({ ...valid, senderCategory: "association", senderLastName: "Les Amis du Parc" });
    expect(p.name).toBe("Les Amis du Parc");
    expect(p.first_name).toBeNull();
    expect(p.metadata).toEqual({ category: "association" });
  });
});

describe("routage d'un organisme du Socle vers un tenant Clara", () => {
  // racine R → service S → bureau B
  const parentOf = new Map<string, string | null>([
    ["R", null],
    ["S", "R"],
    ["B", "S"],
  ]);

  it("compte les remontées jusqu'à l'ancre du tenant", () => {
    expect(distanceToAnchor("B", "B", parentOf)).toBe(0);
    expect(distanceToAnchor("B", "S", parentOf)).toBe(1);
    expect(distanceToAnchor("B", "R", parentOf)).toBe(2);
  });

  it("écarte un miroir dont l'ancre n'est pas un ancêtre", () => {
    expect(distanceToAnchor("B", "X", parentOf)).toBeNull();
  });

  it("ne boucle pas sur un miroir cyclique", () => {
    const cyclic = new Map<string, string | null>([["A", "C"], ["C", "A"]]);
    expect(distanceToAnchor("A", "Z", cyclic)).toBeNull();
  });

  it("choisit le tenant à l'ancre la plus proche", () => {
    expect(pickTenant([
      { organizationId: "collectivite", distance: 2 },
      { organizationId: "service", distance: 1 },
    ])).toEqual({ kind: "one", organizationId: "service" });
  });

  it("refuse de choisir à égalité, et ne route pas sans candidat valable", () => {
    expect(pickTenant([
      { organizationId: "a", distance: 1 },
      { organizationId: "b", distance: 1 },
    ])).toEqual({ kind: "ambiguous", organizationIds: ["a", "b"] });
    expect(pickTenant([{ organizationId: "a", distance: null }])).toEqual({ kind: "none" });
    expect(pickTenant([])).toEqual({ kind: "none" });
  });
});

describe("utilitaires", () => {
  it("isUuid", () => {
    expect(isUuid("3f2b6c1e-8a4d-4b7e-9c2a-1d5e6f7a8b9c")).toBe(true);
    expect(isUuid("pas-un-uuid")).toBe(false);
    expect(isUuid(null)).toBe(false);
  });

  it("safeStorageName", () => {
    expect(safeStorageName("Lettre d'été (v2).pdf")).toBe("Lettre_d_t_v2_.pdf");
  });
});
