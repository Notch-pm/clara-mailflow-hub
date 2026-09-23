import { describe, expect, it } from "vitest";
import {
  applySocleFormPrefill,
  arpegePrefillToSocleRequester,
  contactToArpegeValues,
  contactToSocleRequester,
  contactTypeToAudience,
  formatContactAddressInline,
  isFrenchMobile,
  mergeNonEmpty,
  resolveAudience,
} from "../../lib/prefill-mapping";
import { parseFormSchema } from "../../lib/socle-form";
import type { SocleContact } from "../../services/socleContactService";

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeContact(overrides: Partial<SocleContact> = {}): SocleContact {
  return {
    id: "c1",
    organization_id: "org-racine",
    contact_type: "personne",
    civility: "madame",
    first_name: "Jeanne",
    last_name: "Dupont",
    usage_name: null,
    birth_date: null,
    legal_name: null,
    siret: null,
    display_name: "Dupont Jeanne",
    email: "jeanne@exemple.fr",
    mobile_phone: "06 12 34 56 78",
    landline_phone: null,
    address_line1: "12 bis rue des Lilas",
    address_line2: null,
    postal_code: "13200",
    city: "Arles",
    country: "France",
    preferred_channel: null,
    consent_traitement: false,
    consent_traitement_at: null,
    consent_partage: false,
    consent_partage_at: null,
    internal_notes: null,
    status: "active",
    roles: [],
    external_references: [],
    relations: [],
    reverse_relations: [],
    created_at: null,
    updated_at: null,
    ...overrides,
  };
}

const SCHEMA = parseFormSchema({
  version: 1,
  content: [
    { id: "f-txt", key: "motif", label: "Motif", type: "text" },
    {
      id: "f-sel", key: "type_demande", label: "Type", type: "select",
      options: [{ value: "perte", label: "Perte" }, { value: "vol", label: "Vol" }],
    },
    {
      id: "sec-1", kind: "section", title: "Détails",
      fields: [
        {
          id: "f-cb", key: "creneaux", label: "Créneaux", type: "checkboxes",
          options: [{ value: "matin", label: "Matin" }, { value: "aprem", label: "Après-midi" }],
        },
        { id: "f-bool", key: "urgent", label: "Urgent", type: "boolean" },
        { id: "f-num", key: "", label: "Sans clé", type: "number" },
        { id: "f-pj", key: "photo", label: "Photo", type: "attachment", maxFiles: 1, acceptedFormats: [] },
      ],
    },
  ],
});

// ── Helpers ─────────────────────────────────────────────────────────────────

describe("formatContactAddressInline / isFrenchMobile / mergeNonEmpty", () => {
  it("adresse du contact jointe sur une ligne", () => {
    expect(formatContactAddressInline(makeContact())).toBe("12 bis rue des Lilas, 13200 Arles");
    expect(formatContactAddressInline(makeContact({
      address_line1: null, address_line2: null, postal_code: null, city: null,
    }))).toBe("");
    expect(formatContactAddressInline(makeContact({ address_line2: "Bât. B" })))
      .toBe("12 bis rue des Lilas, Bât. B, 13200 Arles");
  });

  it("heuristique mobile 06/07 avec ou sans indicatif", () => {
    expect(isFrenchMobile("06 12 34 56 78")).toBe(true);
    expect(isFrenchMobile("+33 7 12 34 56 78")).toBe(true);
    expect(isFrenchMobile("04 90 12 34 56")).toBe(false);
  });

  it("mergeNonEmpty : le préféré gagne, les vides n'écrasent pas", () => {
    expect(mergeNonEmpty({ a: "1", b: "  " }, { a: "x", b: "2", c: "3" })).toEqual({
      a: "1", b: "2", c: "3",
    });
  });
});

// ── Sources structurées → clés demandeur ────────────────────────────────────

describe("contactToSocleRequester", () => {
  it("mappe le contact Socle vers les clés demandeur (civilité au même format)", () => {
    const values = contactToSocleRequester(makeContact(), null);
    expect(values).toEqual({
      civilite: "madame",
      nom_naissance: "Dupont",
      nom_usuel: "Dupont",
      prenoms: "Jeanne",
      courriel: "jeanne@exemple.fr",
      adresse: "12 bis rue des Lilas, 13200 Arles",
      tel_portable: "06 12 34 56 78",
    });
  });

  it("le contact prime sur le participant, qui comble les trous", () => {
    const values = contactToSocleRequester(
      makeContact({ email: null }),
      { last_name: "Autre", email: "participant@exemple.fr", address: "1 rue X" },
    );
    expect(values.nom_naissance).toBe("Dupont");
    expect(values.courriel).toBe("participant@exemple.fr");
    expect(values.adresse).toBe("12 bis rue des Lilas, 13200 Arles");
  });

  it("structure → raison_sociale depuis legal_name ; fixe/mobile natifs du contact", () => {
    const values = contactToSocleRequester(
      makeContact({
        contact_type: "entreprise",
        civility: null,
        first_name: null,
        last_name: null,
        legal_name: "ACME SAS",
        display_name: "ACME SAS",
        mobile_phone: null,
        landline_phone: "04 90 11 22 33",
      }),
      { organization: "ACME (participant)" },
    );
    expect(values.raison_sociale).toBe("ACME SAS");
    expect(values.tel_fixe).toBe("04 90 11 22 33");
    expect(values.tel_portable).toBeUndefined();
  });

  it("sans contact : valeurs du participant seul (heuristique mobile)", () => {
    expect(contactToSocleRequester(null, { first_name: "Ali", phone: "07 00 00 00 00" })).toEqual({
      prenoms: "Ali",
      tel_portable: "07 00 00 00 00",
    });
  });
});

describe("contactToArpegeValues", () => {
  it("mappe civilité, noms, date de naissance et téléphones vers les codes Arpège", () => {
    const values = contactToArpegeValues(
      makeContact({ usage_name: "Martin", birth_date: "1990-05-01", landline_phone: "04 90 00 00 00" }),
      null,
    );
    expect(values).toEqual({
      CIVILITE: "MME",
      NOM_NAISSANCE: "Dupont",
      NOM_USUEL: "Martin",
      PRENOMS: "Jeanne",
      DATE_NAISSANCE: "1990-05-01",
      EMAIL: "jeanne@exemple.fr",
      TEL_MOBILE: "06 12 34 56 78",
      TEL_FIXE: "04 90 00 00 00",
    });
    expect(contactToArpegeValues(makeContact({ civility: "monsieur" }), null).CIVILITE).toBe("M");
  });
});

describe("arpegePrefillToSocleRequester", () => {
  it("convertit les clés Arpège (LLM) vers les clés Socle", () => {
    expect(arpegePrefillToSocleRequester({
      CIVILITE: "MLLE",
      NOM_NAISSANCE: "Durand",
      PRENOMS: "Zoé",
      EMAIL: "z@exemple.fr",
      TEL_MOBILE: "0611111111",
      TEL_FIXE: "0490111111",
    })).toEqual({
      civilite: "madame",
      nom_naissance: "Durand",
      prenoms: "Zoé",
      courriel: "z@exemple.fr",
      tel_portable: "0611111111",
      tel_fixe: "0490111111",
    });
    expect(arpegePrefillToSocleRequester({ CIVILITE: "M" }).civilite).toBe("monsieur");
    expect(arpegePrefillToSocleRequester(null)).toEqual({});
  });
});

// ── Audience ────────────────────────────────────────────────────────────────

describe("contactTypeToAudience / resolveAudience", () => {
  it("mappe le type de contact Socle vers un public de démarche", () => {
    expect(contactTypeToAudience("personne")).toBe("citoyen");
    expect(contactTypeToAudience("entreprise")).toBe("entreprise");
    expect(contactTypeToAudience("association")).toBe("association");
    expect(contactTypeToAudience("administration")).toBeNull();
    expect(contactTypeToAudience(null)).toBeNull();
  });

  it("type du contact > déduction LLM > premier public activé", () => {
    expect(resolveAudience(["citoyen", "entreprise"], "entreprise", "citoyen")).toBe("entreprise");
    expect(resolveAudience(["citoyen", "entreprise"], null, "entreprise")).toBe("entreprise");
    expect(resolveAudience(["citoyen", "entreprise"], null, null)).toBe("citoyen");
  });

  it("candidate absente des publics activés → ignorée ; aucun public → null", () => {
    expect(resolveAudience(["citoyen"], "association", "entreprise")).toBe("citoyen");
    expect(resolveAudience([], "citoyen", null)).toBeNull();
  });
});

// ── applySocleFormPrefill ───────────────────────────────────────────────────

describe("applySocleFormPrefill", () => {
  it("mappe key→id contre le schéma courant et revalide les valeurs", () => {
    const out = applySocleFormPrefill(SCHEMA, {
      motif: "  Perte de badge ",
      type_demande: "perte",
      creneaux: ["matin", "inconnu"],
      urgent: "true",
      "f-num": "3,5", // champ sans key → indexé par id
      cle_disparue: "ignorée",
    });
    expect(out).toEqual({
      "f-txt": "Perte de badge",
      "f-sel": "perte",
      "f-cb": ["matin"],
      "f-bool": true,
      "f-num": "3.5",
    });
  });

  it("valeur d'option devenue invalide ou mal typée → ignorée", () => {
    expect(applySocleFormPrefill(SCHEMA, {
      type_demande: "PERTE",
      creneaux: "matin",
      urgent: "false",
      photo: ["doc-1"], // attachment jamais prérempli
    })).toEqual({});
    expect(applySocleFormPrefill(SCHEMA, null)).toEqual({});
  });
});

describe("applySocleFormPrefill — champ `location`", () => {
  const LIEU = parseFormSchema({
    version: 1,
    content: [{ id: "ep-lieu", key: "intervention_lieu", type: "location", label: "Lieu d'intervention" }],
  });

  it("l'adresse rendue par l'IA devient un lieu SANS point (jamais géocodé à sa place)", () => {
    expect(applySocleFormPrefill(LIEU, { intervention_lieu: " Parvis de l'église Saint-Lazare " })).toEqual({
      "ep-lieu": { address: "Parvis de l'église Saint-Lazare", lat: null, lon: null, precision: null, adjusted: false },
    });
    expect(applySocleFormPrefill(LIEU, { intervention_lieu: "" })).toEqual({});
  });
});
