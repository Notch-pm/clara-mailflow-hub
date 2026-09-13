import { describe, expect, it } from "vitest";
import {
  brandingColors,
  brandingWarning,
  hexColor,
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

describe("brandingColors", () => {
  it("ne retient que les deux couleurs, normalisées", () => {
    expect(brandingColors(dto({ primary_color: "#E52322" }))).toEqual({
      primary_color: "#e52322",
      secondary_color: "#f2c02c",
    });
  });

  it("charte absente ou vide ⇒ deux nulls", () => {
    expect(brandingColors(null)).toEqual({ primary_color: null, secondary_color: null });
    expect(brandingColors(undefined)).toEqual({ primary_color: null, secondary_color: null });
    expect(brandingColors(dto({ configured: false, primary_color: null, secondary_color: null })))
      .toEqual({ primary_color: null, secondary_color: null });
  });
});

describe("planBrandingUpdate", () => {
  it("retourne null quand le miroir est déjà aligné", () => {
    const current = { primary_color: "#e52322", secondary_color: "#f2c02c" };
    expect(planBrandingUpdate(current, dto())).toBeNull();
  });

  it("recopie les couleurs du référentiel", () => {
    const current = { primary_color: "#00d084", secondary_color: "#ffcd57" };
    expect(planBrandingUpdate(current, dto())).toEqual({
      primary_color: "#e52322",
      secondary_color: "#f2c02c",
    });
  });

  it("ne retourne que les champs qui changent", () => {
    const current = { primary_color: "#e52322", secondary_color: null };
    expect(planBrandingUpdate(current, dto())).toEqual({ secondary_color: "#f2c02c" });
  });

  it("efface le miroir quand le référentiel ne déclare plus de couleur", () => {
    const current = { primary_color: "#e52322", secondary_color: "#f2c02c" };
    expect(planBrandingUpdate(current, dto({ configured: false, primary_color: null, secondary_color: null })))
      .toEqual({ primary_color: null, secondary_color: null });
  });

  it("réécrit une casse héritée de l'ancienne saisie Clara", () => {
    // Les valeurs saisies dans Clara avant le 2026-09-13 étaient en majuscules.
    const current = { primary_color: "#E52322", secondary_color: "#F2C02C" };
    expect(planBrandingUpdate(current, dto())).toEqual({
      primary_color: "#e52322",
      secondary_color: "#f2c02c",
    });
  });

  it("traite une colonne absente comme nulle", () => {
    expect(planBrandingUpdate({}, dto())).toEqual({
      primary_color: "#e52322",
      secondary_color: "#f2c02c",
    });
    expect(planBrandingUpdate({}, dto({ primary_color: null, secondary_color: null }))).toBeNull();
  });

  it("ignore une couleur mal formée plutôt que de la recopier", () => {
    // La contrainte organizations_branding_colors_hex ferait échouer la
    // synchronisation entière au milieu d'un tenant.
    const current = { primary_color: "#e52322", secondary_color: null };
    expect(planBrandingUpdate(current, dto({ primary_color: "bleu roi", secondary_color: null })))
      .toEqual({ primary_color: null });
  });

  it("charte héritée d'un ancêtre : rien de particulier à faire côté Clara", () => {
    // Le Socle a déjà résolu l'héritage — `inherited` est informatif.
    const current = { primary_color: null, secondary_color: null };
    expect(planBrandingUpdate(current, dto({ inherited: true, source_organization_id: "accm" })))
      .toEqual({ primary_color: "#e52322", secondary_color: "#f2c02c" });
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
