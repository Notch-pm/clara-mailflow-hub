import { describe, expect, it } from "vitest";
import {
  capitalizeFirst,
  formatLongDate,
  headerDatePhrase,
  initialsOf,
  originList,
  splitTransitions,
} from "@/lib/courier-workspace";

describe("originList", () => {
  it("renvoie aux sortants pour un courrier sortant, quel que soit l'état", () => {
    expect(originList("processed", true).href).toBe("/courriers-sortants");
  });
  it("suit la catégorie de l'état courant", () => {
    expect(originList("processed", false).href).toBe("/courriers-traites");
    expect(originList("archived", false).href).toBe("/courriers-archives");
    expect(originList("processing", false).href).toBe("/courriers-en-instruction");
  });
  it("retombe sur « À instruire » sans catégorie connue", () => {
    expect(originList(null, false).href).toBe("/a-instruire");
    expect(originList("autre", false).label).toBe("À instruire");
  });
});

describe("formatLongDate", () => {
  it("renvoie null sans date", () => {
    expect(formatLongDate(null)).toBeNull();
    expect(formatLongDate(undefined)).toBeNull();
  });
  it("formate en français", () => {
    expect(formatLongDate("2026-03-05T12:00:00Z")).toBe("5 mars 2026");
  });
});

describe("initialsOf", () => {
  it("prend la première lettre du premier et du dernier mot", () => {
    expect(initialsOf("jean de la Fontaine")).toBe("JF");
  });
  it("gère un seul mot et l'absence de nom", () => {
    expect(initialsOf("Alice")).toBe("A");
    expect(initialsOf("  ")).toBe("?");
    expect(initialsOf(null)).toBe("?");
  });
});

describe("splitTransitions", () => {
  const t = (id: string, kind: string | null) => ({ id, kind });
  it("isole la nominale et le retour, le reste va dans les autres", () => {
    const r = splitTransitions([t("a", "next"), t("b", null), t("c", "previous"), t("d", null)]);
    expect(r.next?.id).toBe("a");
    expect(r.previous?.id).toBe("c");
    expect(r.others.map((x) => x.id)).toEqual(["b", "d"]);
  });
  it("tolère l'absence de transitions", () => {
    expect(splitTransitions(undefined)).toEqual({ next: undefined, previous: undefined, others: [] });
  });
});

describe("phrases de date", () => {
  it("compose la phrase ou rien", () => {
    expect(headerDatePhrase("envoyé", "5 mars 2026")).toBe("envoyé le 5 mars 2026");
    expect(headerDatePhrase("envoyé", null)).toBeNull();
  });
  it("met la capitale", () => {
    expect(capitalizeFirst("reçu le 5 mars")).toBe("Reçu le 5 mars");
  });
});
