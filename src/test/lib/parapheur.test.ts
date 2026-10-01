import { describe, expect, it } from "vitest";
import { inVisaScope, nextSelection, parapheurTabs, shortWaitLabel, startOfMonthIso } from "@/lib/parapheur";
import { canAccessParapheur, navItemVisible } from "@/lib/permissions";

describe("accès au parapheur", () => {
  it("est ouvert au viseur comme au signataire, quel que soit le rôle", () => {
    expect(canAccessParapheur({ is_viseur: true })).toBe(true);
    expect(canAccessParapheur({ is_signataire: true })).toBe(true);
    expect(canAccessParapheur({ is_viseur: false, is_signataire: false })).toBe(false);
    expect(canAccessParapheur(null)).toBe(false);
  });

  it("commande l'entrée du rail", () => {
    expect(navItemVisible("/parapheur", null, { role: "gestionnaire", is_viseur: true })).toBe(true);
    expect(navItemVisible("/parapheur", { is_superadmin: true }, { role: "administrateur" })).toBe(false);
  });
});

describe("parapheurTabs", () => {
  it("n'ouvre que les onglets des attributs portés", () => {
    expect(parapheurTabs({ is_viseur: true, is_signataire: true })).toEqual(["visa", "signature", "done"]);
    expect(parapheurTabs({ is_viseur: true })).toEqual(["visa", "done"]);
    expect(parapheurTabs({ is_signataire: true })).toEqual(["signature", "done"]);
  });
});

describe("inVisaScope", () => {
  it("« Désignées à moi » garde les réponses sans viseur désigné", () => {
    expect(inVisaScope({ designatedToOther: false }, "mine")).toBe(true);
    expect(inVisaScope({ designatedToOther: true }, "mine")).toBe(false);
    expect(inVisaScope({ designatedToOther: true }, "all")).toBe(true);
  });
});

describe("nextSelection", () => {
  const ids = ["a", "b", "c", "d"];

  it("passe à la ligne qui prend la place de la courante", () => {
    expect(nextSelection(ids, "b", ["b"])).toBe("c");
  });

  it("remonte d'un cran quand la dernière sort", () => {
    expect(nextSelection(ids, "d", ["d"])).toBe("c");
  });

  it("garde la courante si elle n'est pas traitée", () => {
    expect(nextSelection(ids, "c", ["a", "b"])).toBe("c");
  });

  it("tient compte des lignes retirées avant la courante", () => {
    expect(nextSelection(ids, "c", ["a", "c"])).toBe("d");
  });

  it("rend null quand la file est vide", () => {
    expect(nextSelection(["a"], "a", ["a"])).toBeNull();
  });
});

describe("libellés", () => {
  it("abrège l'attente", () => {
    expect(shortWaitLabel(0)).toBe("Aujourd'hui");
    expect(shortWaitLabel(6)).toBe("6 j");
  });

  it("part du premier jour du mois civil", () => {
    expect(new Date(startOfMonthIso(new Date(2026, 9, 17, 15))).getTime()).toBe(new Date(2026, 9, 1).getTime());
  });
});
