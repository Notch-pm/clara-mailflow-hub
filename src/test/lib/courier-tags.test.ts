import { describe, expect, it } from "vitest";
import {
  groupOfAppliedTag,
  indexTagsByName,
  splitAppliedTags,
  tagsOfGroup,
} from "@/lib/courier-tags";
import {
  defaultColorFor,
  paletteFor,
  SENTIMENT_COLOR_RAMP,
  THEME_COLOR_PALETTE,
  type CourierTag,
} from "@/services/courierTagService";
import { readableTextColor } from "@/lib/tag-color";

function tag(name: string, group: "theme" | "sentiment", color = "hsl(0 0% 50%)"): CourierTag {
  return {
    id: name,
    organization_id: "org",
    name,
    color,
    tag_group: group,
    created_at: "2026-09-10T00:00:00.000Z",
    created_by: null,
  };
}

const REFERENTIEL = [
  tag("Voirie", "theme"),
  tag("Sécurité", "theme"),
  tag("Mécontentement", "sentiment"),
  tag("Satisfaction", "sentiment"),
];

describe("splitAppliedTags", () => {
  it("range chaque tag appliqué dans son groupe", () => {
    const out = splitAppliedTags(["Voirie", "Mécontentement", "Sécurité"], REFERENTIEL);
    expect(out.theme.map((t) => t.name)).toEqual(["Voirie", "Sécurité"]);
    expect(out.sentiment.map((t) => t.name)).toEqual(["Mécontentement"]);
  });

  it("rapproche sans tenir compte de la casse", () => {
    const out = splitAppliedTags(["voirie", "SATISFACTION"], REFERENTIEL);
    expect(out.theme.map((t) => t.name)).toEqual(["voirie"]);
    expect(out.sentiment.map((t) => t.name)).toEqual(["SATISFACTION"]);
    // Le nom appliqué fait foi pour l'affichage, la fiche sert à la couleur.
    expect(out.theme[0].tag?.name).toBe("Voirie");
  });

  it("compte un orphelin en thème — même règle que stats_tag_evolution", () => {
    // Tag supprimé du référentiel après avoir été appliqué : le ranger en
    // sentiment fausserait la courbe la plus lue.
    const out = splitAppliedTags(["Tag disparu"], REFERENTIEL);
    expect(out.theme.map((t) => t.name)).toEqual(["Tag disparu"]);
    expect(out.theme[0].tag).toBeNull();
    expect(out.sentiment).toEqual([]);
    expect(groupOfAppliedTag("Tag disparu", indexTagsByName(REFERENTIEL))).toBe("theme");
  });

  it("préserve l'ordre d'application dans chaque groupe", () => {
    const out = splitAppliedTags(["Sécurité", "Voirie"], REFERENTIEL);
    expect(out.theme.map((t) => t.name)).toEqual(["Sécurité", "Voirie"]);
  });

  it("rend deux groupes vides pour un courrier sans tag", () => {
    expect(splitAppliedTags([], REFERENTIEL)).toEqual({ theme: [], sentiment: [] });
  });
});

describe("tagsOfGroup", () => {
  it("filtre le référentiel par groupe", () => {
    expect(tagsOfGroup(REFERENTIEL, "sentiment").map((t) => t.name))
      .toEqual(["Mécontentement", "Satisfaction"]);
  });
});

describe("palettes", () => {
  it("sert le dégradé aux sentiments et les teintes diversifiées aux thèmes", () => {
    expect(paletteFor("sentiment")).toBe(SENTIMENT_COLOR_RAMP);
    expect(paletteFor("theme")).toBe(THEME_COLOR_PALETTE);
  });

  it("ordonne le dégradé du vert au rouge", () => {
    // La position PORTE le sens : c'est ce qui rend une courbe de sentiments
    // lisible. Une teinte qui remonte casserait la lecture.
    const hues = SENTIMENT_COLOR_RAMP.map((c) => Number(c.value.match(/hsl\((\d+)/)![1]));
    expect(hues[0]).toBeGreaterThan(hues[hues.length - 1]);
    for (let i = 1; i < hues.length; i++) expect(hues[i]).toBeLessThan(hues[i - 1]);
    expect(hues[hues.length - 1]).toBe(0); // rouge franc
  });

  it("tient le vert et le rouge hors de la palette des thèmes", () => {
    // Un thème peint en rouge se lirait comme une alerte.
    for (const { value } of THEME_COLOR_PALETTE) {
      const [, h, s] = value.match(/hsl\((\d+) (\d+)% (\d+)%\)/)!.map(Number);
      const saturated = s > 30;
      if (!saturated) continue; // gris et ardoise : aucune teinte à juger
      expect(h < 10 || (h > 100 && h < 170)).toBe(false);
    }
  });

  it("propose une couleur par défaut cohérente avec le groupe", () => {
    expect(SENTIMENT_COLOR_RAMP.map((c) => c.value)).toContain(defaultColorFor("sentiment"));
    expect(THEME_COLOR_PALETTE.map((c) => c.value)).toContain(defaultColorFor("theme"));
  });

  it("reste lisible : chaque couleur trouve un texte contrasté", () => {
    for (const { value } of [...SENTIMENT_COLOR_RAMP, ...THEME_COLOR_PALETTE]) {
      expect(["#000", "#fff"]).toContain(readableTextColor(value));
    }
  });
});
