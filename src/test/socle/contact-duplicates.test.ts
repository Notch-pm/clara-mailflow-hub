import { describe, it, expect } from "vitest";
import {
  duplicateSearchFragments,
  hasDuplicateSignal,
  matchContact,
  normalizeEmail,
  normalizePhone,
  normalizeText,
  similarity,
  type ContactDraft,
} from "@/lib/contact-duplicates";
import type { SocleContact } from "@/services/socleContactService";

/** Fiche Socle minimale : seuls les champs d'identité comptent ici. */
function contact(overrides: Partial<SocleContact> = {}): SocleContact {
  const base: SocleContact = {
    id: "c1",
    organization_id: "org1",
    contact_type: "personne",
    civility: "monsieur",
    first_name: "Jean",
    last_name: "Dupont",
    usage_name: null,
    birth_date: null,
    legal_name: null,
    siret: null,
    display_name: "Dupont Jean",
    email: null,
    mobile_phone: null,
    landline_phone: null,
    address_line1: null,
    address_line2: null,
    postal_code: null,
    city: null,
    country: "FR",
    preferred_channel: null,
    consent_email: false,
    consent_sms: false,
    internal_notes: null,
    status: "active",
    roles: [],
    external_references: [],
    relations: [],
    reverse_relations: [],
    created_at: null,
    updated_at: null,
  };
  return { ...base, ...overrides };
}

describe("normalizeText", () => {
  it("retire accents, casse et ponctuation", () => {
    expect(normalizeText("Éric O'Brien-Müller")).toBe("eric o brien muller");
  });

  it("rend comparables deux graphies du même nom", () => {
    expect(normalizeText("LE GOFF")).toBe(normalizeText("Le Goff"));
  });

  it("renvoie une chaîne vide pour une valeur absente", () => {
    expect(normalizeText(null)).toBe("");
    expect(normalizeText(undefined)).toBe("");
  });
});

describe("normalizePhone", () => {
  it("réduit toutes les écritures d'un mobile français au même numéro", () => {
    const expected = "612345678";
    expect(normalizePhone("06 12 34 56 78")).toBe(expected);
    expect(normalizePhone("+33 6 12 34 56 78")).toBe(expected);
    expect(normalizePhone("0033612345678")).toBe(expected);
    expect(normalizePhone("06.12.34.56.78")).toBe(expected);
  });

  it("gère un fixe", () => {
    expect(normalizePhone("04 91 12 34 56")).toBe("491123456");
  });

  it("ignore une saisie trop courte pour être un numéro", () => {
    expect(normalizePhone("06 12")).toBe("");
    expect(normalizePhone(null)).toBe("");
  });
});

describe("similarity", () => {
  it("vaut 1 pour deux chaînes identiques", () => {
    expect(similarity("dupont jean", "dupont jean")).toBe(1);
  });

  it("reste haute sur une faute de frappe", () => {
    expect(similarity("dupont jean", "dupond jean")).toBeGreaterThan(0.85);
  });

  it("s'effondre entre deux noms différents", () => {
    expect(similarity("dupont jean", "martin sophie")).toBeLessThan(0.5);
  });
});

describe("matchContact — motifs de doublon", () => {
  it("rapproche sur l'email, quelle que soit la casse", () => {
    const draft: ContactDraft = { last_name: "Autre", email: "Jean.DUPONT@example.fr" };
    const match = matchContact(draft, contact({ email: "jean.dupont@example.fr" }));
    expect(match?.reasons).toContain("email");
  });

  it("rapproche sur le téléphone malgré des formats différents", () => {
    const draft: ContactDraft = { last_name: "Dupond", phone: "+33 6 12 34 56 78" };
    const match = matchContact(draft, contact({ mobile_phone: "06 12 34 56 78" }));
    expect(match?.reasons).toContain("phone");
  });

  it("compare le téléphone saisi au fixe comme au mobile de la fiche", () => {
    const draft: ContactDraft = { last_name: "Zzz", phone: "04 91 12 34 56" };
    const match = matchContact(draft, contact({ landline_phone: "+33 4 91 12 34 56" }));
    expect(match?.reasons).toContain("phone");
  });

  it("rapproche sur nom + prénom identiques", () => {
    const draft: ContactDraft = { first_name: "Jean", last_name: "Dupont" };
    expect(matchContact(draft, contact())?.reasons).toContain("name_exact");
  });

  it("rapproche sur une faute de frappe dans le nom", () => {
    const draft: ContactDraft = { first_name: "Jean", last_name: "Dupond" };
    expect(matchContact(draft, contact())?.reasons).toContain("name_similar");
  });

  it("rapproche via le nom d'usage quand la fiche existante en porte un", () => {
    // display_name du Socle est calculé sur usage_name en priorité : deux fiches
    // de la même personne peuvent ne se recouper que sur le nom de naissance.
    const draft: ContactDraft = { first_name: "Marie", last_name: "Martin" };
    const existing = contact({
      first_name: "Marie",
      last_name: "Martin",
      usage_name: "Durand",
      display_name: "Durand Marie",
    });
    expect(matchContact(draft, existing)?.reasons).toContain("name_exact");
  });

  it("rapproche deux structures sur la raison sociale", () => {
    const draft: ContactDraft = { contact_type: "entreprise", legal_name: "Boulangerie du Forum" };
    const existing = contact({
      contact_type: "entreprise",
      first_name: null,
      last_name: null,
      legal_name: "Boulangerie du Forum",
      display_name: "Boulangerie du Forum",
    });
    expect(matchContact(draft, existing)?.reasons).toContain("name_exact");
  });

  it("rapproche le « Nom / Raison sociale » d'un participant sur une raison sociale", () => {
    // Côté participant, le type est inconnu et le nom saisi peut être une structure.
    const draft: ContactDraft = { last_name: "Boulangerie du Forum" };
    const existing = contact({
      contact_type: "entreprise",
      first_name: null,
      last_name: null,
      legal_name: "Boulangerie du Forum",
      display_name: "Boulangerie du Forum",
    });
    expect(matchContact(draft, existing)?.reasons).toContain("name_exact");
  });

  it("rapproche sur le SIRET malgré une raison sociale différente", () => {
    const draft: ContactDraft = { contact_type: "entreprise", legal_name: "Ancien nom", siret: "123 456 789 00012" };
    const existing = contact({ contact_type: "entreprise", legal_name: "Nouveau nom", siret: "12345678900012" });
    expect(matchContact(draft, existing)?.reasons).toContain("siret");
  });
});

describe("matchContact — ce qui ne doit PAS être un doublon", () => {
  it("ne rapproche pas deux personnes du même nom de famille", () => {
    const draft: ContactDraft = { first_name: "Marie", last_name: "Dupont" };
    expect(matchContact(draft, contact({ first_name: "Jean" }))).toBeNull();
  });

  it("ne rapproche pas sur la seule date de naissance", () => {
    const draft: ContactDraft = { first_name: "Sophie", last_name: "Martin", birth_date: "1980-05-12" };
    const existing = contact({ birth_date: "1980-05-12" });
    expect(matchContact(draft, existing)).toBeNull();
  });

  it("ajoute la date de naissance comme motif quand un autre motif existe", () => {
    const draft: ContactDraft = { first_name: "Jean", last_name: "Dupont", birth_date: "1980-05-12" };
    const match = matchContact(draft, contact({ birth_date: "1980-05-12" }));
    expect(match?.reasons).toEqual(expect.arrayContaining(["name_exact", "birth_date"]));
  });

  it("ne rapproche rien sur une saisie vide", () => {
    expect(matchContact({}, contact())).toBeNull();
  });

  it("ne rapproche pas deux emails absents des deux côtés", () => {
    const draft: ContactDraft = { last_name: "Zzzz", email: "" };
    expect(matchContact(draft, contact({ email: null }))).toBeNull();
  });

  it("ne rapproche pas deux téléphones absents des deux côtés", () => {
    const draft: ContactDraft = { last_name: "Zzzz", phone: "" };
    expect(matchContact(draft, contact({ mobile_phone: null, landline_phone: null }))).toBeNull();
  });
});

describe("matchContact — classement", () => {
  it("classe un email identique au-dessus d'un simple nom proche", () => {
    const emailMatch = matchContact({ email: "jean.dupont@example.fr" }, contact({ email: "jean.dupont@example.fr" }));
    const nameMatch = matchContact({ first_name: "Jean", last_name: "Dupond" }, contact());
    expect(emailMatch!.score).toBeGreaterThan(nameMatch!.score);
  });

  it("cumule les motifs", () => {
    const single = matchContact({ first_name: "Jean", last_name: "Dupont" }, contact());
    const multiple = matchContact(
      { first_name: "Jean", last_name: "Dupont", email: "j.d@example.fr" },
      contact({ email: "j.d@example.fr" }),
    );
    expect(multiple!.score).toBeGreaterThan(single!.score);
  });
});

describe("duplicateSearchFragments", () => {
  it("cherche un préfixe du nom, pour rattraper une faute de fin", () => {
    // « Dupo » ramène aussi bien Dupont que Dupond côté Socle (ilike %Dupo%).
    expect(duplicateSearchFragments({ last_name: "Dupont" })).toContain("Dupo");
  });

  it("conserve les accents — le ilike du Socle y est sensible", () => {
    expect(duplicateSearchFragments({ last_name: "Éric" })).toContain("Éric");
  });

  it("cherche aussi le prénom, car display_name vaut « NOM Prénom »", () => {
    expect(duplicateSearchFragments({ first_name: "Jean", last_name: "Dupont" })).toContain("Jean");
  });

  it("ignore un prénom trop court pour discriminer", () => {
    expect(duplicateSearchFragments({ first_name: "Jo", last_name: "Dupont" })).not.toContain("Jo");
  });

  it("prend un préfixe plus long pour une raison sociale", () => {
    expect(duplicateSearchFragments({ legal_name: "Boulangerie du Forum" })).toContain("Boulan");
  });

  it("ne produit rien pour une saisie vide ou trop courte", () => {
    expect(duplicateSearchFragments({})).toEqual([]);
    expect(duplicateSearchFragments({ last_name: "D" })).toEqual([]);
  });

  it("borne le nombre de requêtes envoyées au référentiel", () => {
    const fragments = duplicateSearchFragments({
      first_name: "Jean",
      last_name: "Dupont",
      usage_name: "Martin",
      legal_name: "Boulangerie du Forum",
    });
    expect(fragments.length).toBeLessThanOrEqual(3);
  });
});

describe("hasDuplicateSignal", () => {
  it("est vrai dès qu'un nom exploitable est saisi", () => {
    expect(hasDuplicateSignal({ last_name: "Dupont" })).toBe(true);
  });

  it("est vrai sur un email seul", () => {
    expect(hasDuplicateSignal({ email: "jean@example.fr" })).toBe(true);
  });

  it("est faux tant que la saisie ne porte rien d'interrogeable", () => {
    expect(hasDuplicateSignal({})).toBe(false);
    expect(hasDuplicateSignal({ last_name: "D", email: "jean" })).toBe(false);
    // Le Socle n'offre aucun filtre téléphone : un numéro seul n'ouvre aucune requête.
    expect(hasDuplicateSignal({ phone: "0612345678" })).toBe(false);
  });
});

describe("normalizeEmail", () => {
  it("met en minuscules et retire les espaces", () => {
    expect(normalizeEmail("  Jean.Dupont@Example.FR ")).toBe("jean.dupont@example.fr");
  });
});
