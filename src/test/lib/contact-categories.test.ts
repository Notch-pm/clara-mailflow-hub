import { describe, expect, it } from "vitest";
import {
  categoryRoleIds,
  contactCategories,
  matchesCategories,
  roleCategory,
  roleFilterParam,
} from "@/lib/contact-categories";

describe("roleCategory", () => {
  it("reconnaît le code, quel que soit le nom", () => {
    expect(roleCategory({ name: "Conseiller municipal", code: "elu" })).toBe("elu");
    expect(roleCategory({ name: "Agents de la ville", code: "interne" })).toBe("interne");
  });
  it("un code inconnu n'est pas une catégorie, même si le nom ressemble", () => {
    expect(roleCategory({ name: "Élu", code: "autre" })).toBeNull();
  });
  it("repli par nom exact (accents, casse) quand le référentiel ne sert pas de code", () => {
    expect(roleCategory({ name: "Élu" })).toBe("elu");
    expect(roleCategory({ name: " interne " })).toBe("interne");
    expect(roleCategory({ name: "Agent" })).toBeNull();
    expect(roleCategory({ name: "Habitant", code: null })).toBeNull();
  });
});

describe("contactCategories / matchesCategories", () => {
  const elu = { roles: [{ name: "Habitant" }, { name: "Élu", code: "elu" }] };
  const both = { roles: [{ name: "Élu", code: "elu" }, { name: "Interne", code: "interne" }] };

  it("ordre canonique, sans doublon", () => {
    expect(contactCategories(both)).toEqual(["interne", "elu"]);
    expect(contactCategories({ roles: [{ name: "Élu" }, { name: "Elu", code: "elu" }] })).toEqual(["elu"]);
    expect(contactCategories(null)).toEqual([]);
  });

  it("un contact passe s'il porte l'une des catégories demandées", () => {
    expect(matchesCategories(elu, ["interne", "elu"])).toBe(true);
    expect(matchesCategories(elu, ["interne"])).toBe(false);
    expect(matchesCategories({ roles: [] }, ["elu"])).toBe(false);
    expect(matchesCategories({ roles: [] }, [])).toBe(true);
    expect(matchesCategories({ roles: [] }, undefined)).toBe(true);
  });
});

describe("categoryRoleIds", () => {
  it("le code prime sur le nom", () => {
    expect(
      categoryRoleIds([
        { id: "r-nom", name: "Élu" },
        { id: "r-code", name: "Élus du conseil", code: "elu" },
        { id: "r-int", name: "Interne", code: "interne" },
        { id: "r-agent", name: "Agent", code: null },
      ]),
    ).toEqual({ elu: "r-code", interne: "r-int" });
  });
  it("catégorie absente du catalogue : pas de clé", () => {
    expect(categoryRoleIds([{ id: "r1", name: "Habitant", code: null }])).toEqual({});
  });
});

describe("roleFilterParam", () => {
  it("joint les codes, vide = pas de filtre", () => {
    expect(roleFilterParam(["interne", "elu", "elu"])).toBe("interne,elu");
    expect(roleFilterParam([])).toBeUndefined();
    expect(roleFilterParam(undefined)).toBeUndefined();
  });
});
