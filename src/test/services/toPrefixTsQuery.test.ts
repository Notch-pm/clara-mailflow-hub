import { describe, it, expect } from "vitest";
import "../mocks/supabase";

const { toPrefixTsQuery } = await import("@/services/courierService");

describe("toPrefixTsQuery", () => {
  it("suffixe chaque terme par :* pour retrouver les préfixes", () => {
    // Sans le :*, la recherche plein texte n'accepterait que des mots entiers,
    // là où l'ancien ilike '%…%' trouvait « raccord » dans « raccordement ».
    expect(toPrefixTsQuery("raccord")).toBe("raccord:*");
  });

  it("combine les termes multiples avec un ET", () => {
    expect(toPrefixTsQuery("demande subvention")).toBe("demande:* & subvention:*");
  });

  it("neutralise les caractères de syntaxe tsquery", () => {
    // Laissés tels quels, ils feraient échouer to_tsquery côté serveur.
    expect(toPrefixTsQuery("a & b")).toBe("a:* & b:*");
    expect(toPrefixTsQuery("eau (potable)")).toBe("eau:* & potable:*");
    expect(toPrefixTsQuery("!urgent")).toBe("urgent:*");
  });

  it("absorbe les espaces superflus", () => {
    expect(toPrefixTsQuery("  eau   potable  ")).toBe("eau:* & potable:*");
  });

  it("renvoie null quand il ne reste aucun terme exploitable", () => {
    // L'appelant omet alors le filtre, comme pour une recherche vide.
    expect(toPrefixTsQuery("")).toBeNull();
    expect(toPrefixTsQuery("   ")).toBeNull();
    expect(toPrefixTsQuery("&|!()")).toBeNull();
  });

  it("conserve les accents (le dictionnaire french les attend)", () => {
    expect(toPrefixTsQuery("réclamation")).toBe("réclamation:*");
  });
});
