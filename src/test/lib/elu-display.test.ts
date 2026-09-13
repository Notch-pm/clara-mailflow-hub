import { describe, expect, it } from "vitest";
import { orgInitials, personInitials } from "@/lib/elu-display";

/**
 * La tuile d'initiales ne s'affiche que faute de logo, mais elle porte alors
 * l'identité de la collectivité en tête de chaque écran : elle doit être juste.
 */
describe("orgInitials", () => {
  it("écarte les mots-outils et les termes génériques de collectivité", () => {
    // Sinon toutes les intercommunalités d'un département diraient « CA ».
    expect(orgInitials("Communauté d'agglomération Seine Normandie")).toBe("SN");
    expect(orgInitials("Ville de Vernon")).toBe("V");
    expect(orgInitials("Syndicat des eaux de la Vallée")).toBe("EV");
    expect(orgInitials("Communauté de communes du Vexin")).toBe("V");
  });

  it("prend la première LETTRE, pas le premier caractère", () => {
    // Les tenants de test s'appellent « [TEST] Alpha » : sans cela, « [A ».
    expect(orgInitials("[TEST] Alpha")).toBe("TA");
    expect(orgInitials("« Grand Est »")).toBe("GE");
  });

  it("se limite à trois lettres", () => {
    expect(orgInitials("Alpha Beta Gamma Delta")).toBe("ABG");
  });

  it("garde les mots bruts quand tout serait écarté", () => {
    expect(orgInitials("Ville")).toBe("V");
    expect(orgInitials("Communauté de communes")).toBe("CC");
  });

  it("rend un point d'interrogation plutôt que rien", () => {
    expect(orgInitials(null)).toBe("?");
    expect(orgInitials("")).toBe("?");
    expect(orgInitials("   ")).toBe("?");
    expect(orgInitials("123 456")).toBe("?");
  });
});

describe("personInitials", () => {
  it("compose les initiales et bascule en majuscules", () => {
    expect(personInitials("laurent", "saillard")).toBe("LS");
  });

  it("se contente de ce qu'elle a", () => {
    expect(personInitials("Laurent", null)).toBe("L");
    expect(personInitials(null, null)).toBe("U");
  });
});
