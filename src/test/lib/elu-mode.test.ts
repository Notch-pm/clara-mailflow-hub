import { describe, expect, it } from "vitest";
import {
  ELU_MOBILE_QUERY,
  eluDisplayStorageKey,
  parseEluDisplayChoice,
  resolveEluMode,
} from "@/lib/elu-mode";

/**
 * L'espace élu ne doit s'ouvrir QUE si les trois conditions tiennent ensemble.
 * Un faux positif servirait des écrans amputés à un gestionnaire ; un faux
 * négatif rendrait la fonctionnalité invisible.
 */
describe("resolveEluMode", () => {
  const cases: Array<[string, boolean, boolean, boolean]> = [
    // rôle,          téléphone, affichage complet demandé, actif attendu
    ["elu", true, false, true],
    ["elu", true, true, false],
    ["elu", false, false, false],
    ["elu", false, true, false],
    ["gestionnaire", true, false, false],
    ["administrateur", true, false, false],
    ["consultant", true, false, false],
    ["superviseur", true, false, false],
  ];

  it.each(cases)("rôle %s · téléphone %s · complet %s → actif %s", (role, isPhone, optedOut, expected) => {
    const result = resolveEluMode({
      membership: { role },
      isPhone,
      choice: optedOut ? "complet" : "simplifie",
    });
    expect(result.active).toBe(expected);
  });

  it("sans membership → jamais actif (superadmin, compte orphelin)", () => {
    expect(resolveEluMode({ membership: null, isPhone: true, choice: "simplifie" }).active).toBe(false);
  });

  it("expose le détail, pour que l'interface sache POURQUOI elle est complète", () => {
    const result = resolveEluMode({ membership: { role: "elu" }, isPhone: false, choice: "simplifie" });
    expect(result).toMatchObject({ isElu: true, isPhone: false, optedOut: false, active: false });
  });
});

describe("parseEluDisplayChoice", () => {
  it("ne retient « complet » que sur la valeur exacte", () => {
    expect(parseEluDisplayChoice("complet")).toBe("complet");
    expect(parseEluDisplayChoice("simplifie")).toBe("simplifie");
  });

  it("toute valeur inconnue ou absente retombe sur l'affichage simplifié", () => {
    // Une clé corrompue ne doit pas priver l'élu de son espace.
    expect(parseEluDisplayChoice(null)).toBe("simplifie");
    expect(parseEluDisplayChoice(undefined)).toBe("simplifie");
    expect(parseEluDisplayChoice("")).toBe("simplifie");
    expect(parseEluDisplayChoice("COMPLET")).toBe("simplifie");
  });
});

describe("eluDisplayStorageKey", () => {
  it("scope la clé par utilisateur : un téléphone de service est partagé", () => {
    expect(eluDisplayStorageKey("u1")).toBe("clara.elu-affichage:u1");
    expect(eluDisplayStorageKey("u1")).not.toBe(eluDisplayStorageKey("u2"));
  });
});

describe("ELU_MOBILE_QUERY", () => {
  it("est le complément exact de `md:` — pas de trou entre 767 et 768", () => {
    // `max-width: 767px` laisserait 767,5 px sans gabarit : CSS déjà mobile,
    // garde encore desktop.
    expect(ELU_MOBILE_QUERY).toBe("(max-width: 767.98px)");
  });
});
