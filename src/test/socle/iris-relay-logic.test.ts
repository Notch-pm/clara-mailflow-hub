import { describe, expect, it } from "vitest";
import {
  IRIS_DEFAULT_SUBJECT,
  IRIS_MAX_FILES,
  IRIS_MAX_FILE_SIZE,
  irisAgentParticipant,
  irisFieldsFromForm,
  irisRelayError,
  irisSenderParticipant,
  irisSubject,
  type IrisRelayFields,
} from "../../../supabase/functions/_shared/irisRelayLogic";

const CONTACT_ID = "4f1c2a9e-1b2c-4d3e-8f9a-0b1c2d3e4f5a";

function fields(over: Partial<IrisRelayFields> = {}): IrisRelayFields {
  return {
    subject: null,
    body: "Demande de raccordement au réseau pour une parcelle agricole.",
    senderCategory: "citoyen",
    senderCivilite: "monsieur",
    senderFirstName: "Jean",
    senderLastName: "Martin",
    senderEmail: null,
    senderPhone: null,
    senderSocleContactId: CONTACT_ID,
    relayedByName: "Agent Accueil",
    relayedByEmail: "accueil@mairie.fr",
    ...over,
  };
}

describe("irisFieldsFromForm", () => {
  it("lit les champs, ramène le vide à null et ignore ce qui n'est pas du texte", () => {
    const form: Record<string, unknown> = {
      body: "  Texte  ",
      subject: "   ",
      sender_last_name: "Martin",
      sender_socle_contact_id: CONTACT_ID,
      relayed_by_name: "Agent",
      sender_email: new Blob(["x"]),
    };
    const f = irisFieldsFromForm((k) => form[k]);
    expect(f.body).toBe("Texte");
    expect(f.subject).toBeNull();
    expect(f.senderLastName).toBe("Martin");
    expect(f.senderSocleContactId).toBe(CONTACT_ID);
    expect(f.senderEmail).toBeNull();
  });
});

describe("irisRelayError", () => {
  it("accepte un relais complet, sans courriel ni téléphone", () => {
    expect(irisRelayError(fields(), [])).toBeNull();
  });
  it("accepte des fichiers seuls, sans texte", () => {
    expect(irisRelayError(fields({ body: null }), [{ name: "scan.pdf", size: 1000 }])).toBeNull();
  });
  it("refuse un relais vide", () => {
    expect(irisRelayError(fields({ body: null }), [])).toBe("Texte ou fichier obligatoire");
  });
  it("exige le nom de l'usager, ou la raison sociale", () => {
    expect(irisRelayError(fields({ senderLastName: null }), [])).toBe("Nom de l'usager obligatoire");
    expect(irisRelayError(fields({ senderCategory: "entreprise", senderLastName: null }), []))
      .toBe("Raison sociale obligatoire");
  });
  it("n'exige pas le prénom : un nom d'usage seul suffit", () => {
    expect(irisRelayError(fields({ senderFirstName: null }), [])).toBeNull();
  });
  it("refuse une catégorie inconnue et une fiche usager mal formée", () => {
    expect(irisRelayError(fields({ senderCategory: "elu" }), [])).toBe("Catégorie invalide");
    expect(irisRelayError(fields({ senderSocleContactId: "pas-un-uuid" }), [])).toBe("Fiche usager invalide");
  });
  it("exige l'agent relais", () => {
    expect(irisRelayError(fields({ relayedByName: null }), [])).toBe("Agent relais obligatoire");
  });
  it("borne le nombre et la taille des fichiers", () => {
    const many = Array.from({ length: IRIS_MAX_FILES + 1 }, (_, i) => ({ name: `f${i}.pdf`, size: 1 }));
    expect(irisRelayError(fields(), many)).toBe(`Maximum ${IRIS_MAX_FILES} fichiers autorisés`);
    expect(irisRelayError(fields(), [{ name: "gros.pdf", size: IRIS_MAX_FILE_SIZE + 1 }]))
      .toBe('Le fichier "gros.pdf" dépasse la limite de 10 Mo');
  });
});

describe("irisSubject", () => {
  it("garde l'objet transmis", () => {
    expect(irisSubject({ subject: "Raccordement", body: "x" })).toBe("Raccordement");
  });
  it("prend la première ligne non vide du texte", () => {
    expect(irisSubject({ subject: null, body: "\n  Bruit nocturne rue des Lilas \nDétails…" }))
      .toBe("Bruit nocturne rue des Lilas");
  });
  it("coupe une longue première ligne au mot", () => {
    const long = "Demande de prise en charge d'un dossier de succession complexe impliquant plusieurs héritiers domiciliés à l'étranger";
    const subject = irisSubject({ subject: null, body: long });
    expect(subject.endsWith("…")).toBe(true);
    expect(subject.length).toBeLessThanOrEqual(91);
    expect(long.startsWith(subject.slice(0, -1))).toBe(true);
  });
  it("a un libellé fixe pour des fichiers seuls", () => {
    expect(irisSubject({ subject: null, body: null })).toBe(IRIS_DEFAULT_SUBJECT);
  });
});

describe("participants", () => {
  it("rattache l'usager à sa fiche du Socle", () => {
    expect(irisSenderParticipant(fields())).toEqual({
      role: "sender",
      name: "Jean Martin",
      first_name: "Jean",
      last_name: "Martin",
      email: null,
      phone: null,
      socle_contact_id: CONTACT_ID,
      metadata: { category: "citoyen", civilite: "monsieur" },
    });
  });
  it("nomme une personne morale par sa raison sociale, sans prénom ni civilité", () => {
    const p = irisSenderParticipant(fields({ senderCategory: "association", senderLastName: "Les Amis du Rhône" }));
    expect(p.name).toBe("Les Amis du Rhône");
    expect(p.first_name).toBeNull();
    expect(p.metadata).toEqual({ category: "association" });
  });
  it("porte l'agent relais en copie, sans identifiant Iris", () => {
    expect(irisAgentParticipant(fields())).toMatchObject({
      role: "cc",
      name: "Agent Accueil",
      email: "accueil@mairie.fr",
      socle_contact_id: null,
      metadata: { relayed_by_agent: true, app: "iris" },
    });
  });
});
