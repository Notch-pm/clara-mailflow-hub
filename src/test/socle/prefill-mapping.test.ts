import { describe, expect, it } from "vitest";
import {
  applySocleFormPrefill,
  arpegePrefillToSocleRequester,
  formatUsagerAddressInline,
  isFrenchMobile,
  mergeNonEmpty,
  resolveAudience,
  usagerToArpegeValues,
  usagerToSocleRequester,
} from "../../lib/prefill-mapping";
import { parseFormSchema } from "../../lib/socle-form";
import type { Usager } from "../../services/usagerService";

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeUsager(overrides: Partial<Usager> = {}): Usager {
  return {
    id: "u1",
    organization_id: "org1",
    category: "citoyen",
    civilite: "madame",
    first_name: "Jeanne",
    last_name: "Dupont",
    email: "jeanne@exemple.fr",
    phone: "06 12 34 56 78",
    created_at: "",
    updated_at: "",
    created_by: null,
    quartier_id: null,
    quartier_auto: false,
    usual_name: null,
    birth_date: null,
    death_date: null,
    family_status: null,
    marriage_date: null,
    pacs_date: null,
    arrival_date: null,
    departure_date: null,
    nationality: null,
    address_number: "12",
    address_btq: "bis",
    address_street: "rue des Lilas",
    address_building: null,
    address_apartment: null,
    address_complement: null,
    address_postal_code: "13200",
    address_city: "Arles",
    address_lat: null,
    address_lon: null,
    phone_2: null,
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

describe("formatUsagerAddressInline / isFrenchMobile / mergeNonEmpty", () => {
  it("adresse structurée jointe sur une ligne", () => {
    expect(formatUsagerAddressInline(makeUsager())).toBe("12 bis rue des Lilas, 13200 Arles");
    expect(formatUsagerAddressInline(makeUsager({
      address_number: null, address_btq: null, address_street: null,
      address_postal_code: null, address_city: null,
    }))).toBe("");
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

describe("usagerToSocleRequester", () => {
  it("mappe l'usager vers les clés Socle (civilite au même format)", () => {
    const values = usagerToSocleRequester(makeUsager(), null);
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

  it("l'usager prime sur le participant, qui comble les trous", () => {
    const values = usagerToSocleRequester(
      makeUsager({ email: null }),
      { last_name: "Autre", email: "participant@exemple.fr", address: "1 rue X" },
    );
    expect(values.nom_naissance).toBe("Dupont");
    expect(values.courriel).toBe("participant@exemple.fr");
    expect(values.adresse).toBe("12 bis rue des Lilas, 13200 Arles");
  });

  it("catégorie entreprise → raison_sociale ; téléphone fixe reconnu", () => {
    const values = usagerToSocleRequester(
      makeUsager({ category: "entreprise", last_name: "ACME SAS", phone: "04 90 11 22 33" }),
      { organization: "ACME (participant)" },
    );
    expect(values.raison_sociale).toBe("ACME SAS");
    expect(values.tel_fixe).toBe("04 90 11 22 33");
    expect(values.tel_portable).toBeUndefined();
  });

  it("sans usager : valeurs du participant seul", () => {
    expect(usagerToSocleRequester(null, { first_name: "Ali", phone: "07 00 00 00 00" })).toEqual({
      prenoms: "Ali",
      tel_portable: "07 00 00 00 00",
    });
  });
});

describe("usagerToArpegeValues", () => {
  it("mappe civilité, noms, date de naissance et mobile vers les codes Arpège", () => {
    const values = usagerToArpegeValues(
      makeUsager({ usual_name: "Martin", birth_date: "1990-05-01" }),
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
    });
    expect(usagerToArpegeValues(makeUsager({ civilite: "monsieur" }), null).CIVILITE).toBe("M");
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

// ── resolveAudience ─────────────────────────────────────────────────────────

describe("resolveAudience", () => {
  it("catégorie usager > déduction LLM > premier public activé", () => {
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
