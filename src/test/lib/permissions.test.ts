import { describe, expect, it } from "vitest";
import {
  canAccessSettings,
  canAccessStats,
  canEditCouriers,
  isElu,
  isOrgAdmin,
  isReadOnlyRole,
  isSuperAdmin,
  ORG_ROLES,
} from "@/lib/permissions";

/**
 * `src/lib/permissions.ts` est le seul point de vérité des droits côté client
 * et n'avait aucun test. On fige ici la matrice, pour que l'ajout de l'espace
 * élu ne déplace rien d'autre.
 */

const superadmin = { is_superadmin: true };
const nobody = { is_superadmin: false };

describe("isElu", () => {
  it("reconnaît le rôle élu", () => {
    expect(isElu({ role: "elu" })).toBe(true);
  });

  it("ne reconnaît que lui", () => {
    for (const role of ["gestionnaire", "administrateur", "admin", "consultant", "superviseur"]) {
      expect(isElu({ role })).toBe(false);
    }
    expect(isElu(null)).toBe(false);
    expect(isElu(undefined)).toBe(false);
    expect(isElu({ role: null })).toBe(false);
  });

  it("est sensible à la casse : aucun alias historique, contrairement à `admin`", () => {
    expect(isElu({ role: "Elu" })).toBe(false);
    expect(isElu({ role: "élu" })).toBe(false);
  });
});

describe("isOrgAdmin", () => {
  it("accepte le libellé actuel ET l'alias historique `admin`", () => {
    expect(isOrgAdmin({ role: "administrateur" })).toBe(true);
    expect(isOrgAdmin({ role: "admin" })).toBe(true);
    expect(isOrgAdmin({ role: "elu" })).toBe(false);
  });
});

describe("canAccessStats", () => {
  it("l'élu y a droit, le gestionnaire non", () => {
    // Régression : c'est ce qui décide de l'onglet « Indicateurs » de l'espace élu.
    expect(canAccessStats(nobody, { role: "elu" })).toBe(true);
    expect(canAccessStats(nobody, { role: "gestionnaire" })).toBe(false);
    expect(canAccessStats(nobody, { role: "administrateur" })).toBe(true);
    expect(canAccessStats(nobody, { role: "consultant" })).toBe(true);
    expect(canAccessStats(nobody, { role: "superviseur" })).toBe(true);
  });

  it("le superadmin passe outre", () => {
    expect(canAccessStats(superadmin, { role: "gestionnaire" })).toBe(true);
  });
});

describe("canEditCouriers", () => {
  it("l'élu écrit comme un gestionnaire ; seul le consultant est en lecture seule", () => {
    expect(canEditCouriers(nobody, { role: "elu" })).toBe(true);
    expect(canEditCouriers(nobody, { role: "consultant" })).toBe(false);
    expect(isReadOnlyRole({ role: "consultant" })).toBe(true);
  });

  it("sans membership, personne n'écrit — sauf superadmin", () => {
    expect(canEditCouriers(nobody, null)).toBe(false);
    expect(canEditCouriers(superadmin, null)).toBe(true);
  });
});

describe("canAccessSettings", () => {
  it("réservé à l'admin d'organisation et au superadmin", () => {
    expect(canAccessSettings(nobody, { role: "elu" })).toBe(false);
    expect(canAccessSettings(nobody, { role: "administrateur" })).toBe(true);
    expect(canAccessSettings(superadmin, { role: "elu" })).toBe(true);
  });
});

describe("ORG_ROLES", () => {
  it("porte les cinq rôles, élu compris, avec leur libellé affichable", () => {
    expect(ORG_ROLES.map((r) => r.value)).toEqual([
      "administrateur",
      "gestionnaire",
      "consultant",
      "elu",
      "superviseur",
    ]);
    expect(ORG_ROLES.find((r) => r.value === "elu")?.label).toBe("Élu");
  });
});

describe("isSuperAdmin", () => {
  it("exige le booléen vrai, pas une valeur truthy", () => {
    expect(isSuperAdmin(superadmin)).toBe(true);
    expect(isSuperAdmin(nobody)).toBe(false);
    expect(isSuperAdmin(null)).toBe(false);
  });
});
