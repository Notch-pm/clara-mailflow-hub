import { describe, expect, it } from "vitest";
import {
  brandingMirror,
  brandingWarning,
  hexColor,
  logoUrl,
  planBrandingUpdate,
  type SocleBrandingDto,
} from "../../../supabase/functions/sync-socle-referentiel/branding";

function dto(overrides: Partial<SocleBrandingDto> = {}): SocleBrandingDto {
  return {
    organization_id: "tenant",
    source_organization_id: "tenant",
    inherited: false,
    configured: true,
    logo_url: "https://socle.example/accm.png",
    logo_white_url: null,
    favicon_url: null,
    primary_color: "#e52322",
    secondary_color: "#f2c02c",
    ...overrides,
  };
}

/** Charte du référentiel, telle que Clara doit la refléter. */
const ALIGNE = {
  logo_url: "https://socle.example/accm.png",
  primary_color: "#e52322",
  secondary_color: "#f2c02c",
};

const VIDE = { logo_url: null, primary_color: null, secondary_color: null };

describe("hexColor", () => {
  it("normalise en minuscules", () => {
    expect(hexColor("#E52322")).toBe("#e52322");
    expect(hexColor("  #F2C02C  ")).toBe("#f2c02c");
  });

  it("refuse tout ce qui n'est pas #rrggbb", () => {
    // Les couleurs de quartier du référentiel sont servies en hsl() : la
    // colonne Clara ne les accepterait pas.
    expect(hexColor("hsl(210 40% 50%)")).toBeNull();
    expect(hexColor("#fff")).toBeNull();
    expect(hexColor("#e52322ff")).toBeNull();
    expect(hexColor("rouge")).toBeNull();
    expect(hexColor("")).toBeNull();
    expect(hexColor(null)).toBeNull();
    expect(hexColor(undefined)).toBeNull();
    expect(hexColor(16724514)).toBeNull();
  });
});

describe("logoUrl", () => {
  it("garde l'URL servie, élaguée", () => {
    expect(logoUrl(" https://socle.example/accm.png ")).toBe("https://socle.example/accm.png");
  });

  it("chaîne vide ⇒ null (une image cassée est pire que pas d'image)", () => {
    expect(logoUrl("")).toBeNull();
    expect(logoUrl("   ")).toBeNull();
    expect(logoUrl(null)).toBeNull();
    expect(logoUrl(undefined)).toBeNull();
    expect(logoUrl(42)).toBeNull();
  });
});

describe("brandingMirror", () => {
  it("retient logo et couleurs, normalisés", () => {
    expect(brandingMirror(dto({ primary_color: "#E52322" }))).toEqual(ALIGNE);
  });

  it("ne retient NI le logo blanc NI le favicon (Clara n'a pas de colonne pour eux)", () => {
    const complet = dto({
      logo_white_url: "https://socle.example/accm-blanc.png",
      favicon_url: "https://socle.example/favicon.png",
    });
    expect(Object.keys(brandingMirror(complet)).sort()).toEqual([
      "logo_url",
      "primary_color",
      "secondary_color",
    ]);
  });

  it("charte absente ou vide ⇒ tout à null", () => {
    expect(brandingMirror(null)).toEqual(VIDE);
    expect(brandingMirror(undefined)).toEqual(VIDE);
    expect(brandingMirror(dto({ configured: false, ...VIDE }))).toEqual(VIDE);
  });
});

describe("planBrandingUpdate", () => {
  it("retourne null quand le miroir est déjà aligné", () => {
    expect(planBrandingUpdate(ALIGNE, dto())).toBeNull();
  });

  it("recopie logo et couleurs du référentiel", () => {
    const current = { logo_url: null, primary_color: "#00d084", secondary_color: "#ffcd57" };
    expect(planBrandingUpdate(current, dto())).toEqual(ALIGNE);
  });

  it("ne retourne que les champs qui changent", () => {
    const current = { ...ALIGNE, secondary_color: null };
    expect(planBrandingUpdate(current, dto())).toEqual({ secondary_color: "#f2c02c" });
  });

  it("efface le miroir quand le référentiel ne déclare plus rien", () => {
    expect(planBrandingUpdate(ALIGNE, dto({ configured: false, ...VIDE }))).toEqual(VIDE);
  });

  it("sous-organisation sans charte propre : elle reçoit celle de sa collectivité", () => {
    // Le cas « Marie d'Arles » : /branding résout l'héritage, là où la colonne
    // brute de l'organisation mappée rendait un logo null.
    expect(planBrandingUpdate(VIDE, dto({ inherited: true, source_organization_id: "accm" })))
      .toEqual(ALIGNE);
  });

  it("réécrit une casse héritée de l'ancienne saisie Clara", () => {
    // Les couleurs saisies dans Clara avant le 2026-09-13 étaient en majuscules.
    const current = { ...ALIGNE, primary_color: "#E52322", secondary_color: "#F2C02C" };
    expect(planBrandingUpdate(current, dto())).toEqual({
      primary_color: "#e52322",
      secondary_color: "#f2c02c",
    });
  });

  it("traite une colonne absente comme nulle", () => {
    expect(planBrandingUpdate({}, dto())).toEqual(ALIGNE);
    expect(planBrandingUpdate({}, dto(VIDE))).toBeNull();
  });

  it("ignore une couleur mal formée plutôt que de la recopier", () => {
    // La contrainte organizations_branding_colors_hex ferait échouer la
    // synchronisation entière au milieu d'un tenant.
    const current = { ...ALIGNE, secondary_color: null };
    expect(planBrandingUpdate(current, dto({ primary_color: "bleu roi", secondary_color: null })))
      .toEqual({ primary_color: null });
  });
});

describe("brandingWarning", () => {
  it("nomme l'organisation et dit que le miroir est intact", () => {
    expect(brandingWarning("ACCM", 500)).toBe(
      "charte graphique (ACCM) : réponse 500 du Socle — miroir inchangé.",
    );
  });

  it("explique 403 et 404", () => {
    expect(brandingWarning("ACCM", 403)).toContain("scope « read »");
    expect(brandingWarning("ACCM", 404)).toContain("hors périmètre");
  });
});
