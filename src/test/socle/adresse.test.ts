import { describe, expect, it } from "vitest";
import {
  addressSearchUrl,
  MIN_QUERY_LENGTH,
  parseAddressSuggestions,
  reverseAddressUrl,
  splitHouseNumber,
  splitStreetLine,
  streetLine,
  suggestionContext,
  toInterventionParts,
  type AddressSuggestion,
} from "@/lib/adresse";

// L'assistance à la saisie d'adresse est un CONFORT : elle propose, elle ne
// garde pas la porte. Toute panne doit se traduire par une absence de
// propositions — jamais par une saisie bloquée ou une exception.

const BAN_RESPONSE = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [-1.5, 47.2] },
      properties: {
        id: "44109_1234_00010",
        label: "10 bis Avenue de Frémeur 44000 Nantes",
        name: "10 bis Avenue de Frémeur",
        housenumber: "10 bis",
        street: "Avenue de Frémeur",
        postcode: "44000",
        city: "Nantes",
        citycode: "44109",
        context: "44, Loire-Atlantique, Pays de la Loire",
        type: "housenumber",
        score: 0.97,
      },
    },
  ],
};

describe("URL du service d'adresse", () => {
  it("ne pose pas de requête en deçà du seuil de bruit", () => {
    expect(addressSearchUrl("ru")).toBeNull();
    expect(addressSearchUrl("   ")).toBeNull();
    expect("rue".length).toBe(MIN_QUERY_LENGTH);
    expect(addressSearchUrl("rue")).not.toBeNull();
  });

  it("demande la complétion, contrairement au géocodage d'une adresse écrite", () => {
    const url = new URL(addressSearchUrl("10 avenue de frémeur")!);
    expect(url.searchParams.get("autocomplete")).toBe("1");
    expect(url.searchParams.get("limit")).toBe("5");
    expect(url.searchParams.get("q")).toBe("10 avenue de frémeur");
  });

  it("déduit l'inverse du point d'entrée de recherche, et renonce s'il n'en est pas un", () => {
    const url = reverseAddressUrl(47.2, -1.5, "https://data.geopf.fr/geocodage/search/");
    expect(url).toContain("/geocodage/reverse/");
    // Endpoint substitué qui n'expose pas l'inverse : mieux vaut retirer le
    // bouton « Utiliser ma position » que composer une URL au hasard.
    expect(reverseAddressUrl(47.2, -1.5, "https://exemple.fr/adresses")).toBeNull();
    expect(reverseAddressUrl(999, -1.5)).toBeNull();
  });
});

describe("lecture d'une réponse BAN", () => {
  it("lit une proposition complète", () => {
    const [s] = parseAddressSuggestions(BAN_RESPONSE);
    expect(s).toMatchObject({
      label: "10 bis Avenue de Frémeur 44000 Nantes",
      housenumber: "10 bis",
      street: "Avenue de Frémeur",
      postcode: "44000",
      city: "Nantes",
      precision: "adresse",
      lat: 47.2,
      lon: -1.5,
    });
  });

  it("saute ce qui n'est pas exploitable, sans jamais lever", () => {
    expect(parseAddressSuggestions(null)).toEqual([]);
    expect(parseAddressSuggestions({ features: "pas un tableau" })).toEqual([]);
    expect(
      parseAddressSuggestions({
        features: [
          { geometry: { coordinates: [0] }, properties: { label: "tronquée" } },
          { geometry: { coordinates: [-1.5, 47.2] }, properties: {} }, // sans libellé
          { geometry: { coordinates: [200, 47.2] }, properties: { label: "hors monde" } },
        ],
      }),
    ).toEqual([]);
  });
});

describe("découpage d'une ligne de voie", () => {
  it("sépare le numéro du BTQ que la BAN rend collés", () => {
    expect(splitHouseNumber("10 bis")).toEqual({ numero: "10", btq: "bis" });
    expect(splitHouseNumber("10")).toEqual({ numero: "10", btq: "" });
    // Ce qui ne commence pas par un nombre est rendu tel quel : le perdre
    // serait pire que de le mettre au mauvais endroit.
    expect(splitHouseNumber("Lieu-dit")).toEqual({ numero: "Lieu-dit", btq: "" });
  });

  it("découpe ce que l'agent tape à la main", () => {
    expect(splitStreetLine("10 bis Avenue de Frémeur")).toEqual({
      numero: "10",
      btq: "bis",
      voie: "Avenue de Frémeur",
    });
    expect(splitStreetLine("12 B rue des Lilas")).toEqual({
      numero: "12",
      btq: "B",
      voie: "rue des Lilas",
    });
    // Sans numéro, tout est voie — rien n'est deviné.
    expect(splitStreetLine("Chemin du Moulin")).toEqual({
      numero: "",
      btq: "",
      voie: "Chemin du Moulin",
    });
  });

  it("recompose la ligne affichée sans espaces parasites", () => {
    expect(streetLine({ numero: "10", btq: "", voie: "Avenue de Frémeur" }))
      .toBe("10 Avenue de Frémeur");
    expect(streetLine({ numero: "", btq: "", voie: "" })).toBe("");
  });
});

describe("projection vers le bloc « Lieu d'intervention »", () => {
  it("remplit numéro, BTQ, voie, code postal et ville", () => {
    const [s] = parseAddressSuggestions(BAN_RESPONSE);
    expect(toInterventionParts(s)).toEqual({
      numero: "10",
      btq: "bis",
      voie: "Avenue de Frémeur",
      code_postal: "44000",
      ville: "Nantes",
    });
  });

  it("prend le libellé comme voie quand la BAN ne rend pas de numéro", () => {
    const suggestion = {
      housenumber: "",
      street: "",
      name: "Avenue de Frémeur",
      postcode: "44000",
      city: "Nantes",
    } as AddressSuggestion;
    expect(toInterventionParts(suggestion).voie).toBe("Avenue de Frémeur");
  });

  it("replie le contexte sur la commune quand le département manque", () => {
    expect(suggestionContext({ context: "", postcode: "44000", city: "Nantes" } as AddressSuggestion))
      .toBe("44000 Nantes");
  });
});
