import { describe, expect, it } from "vitest";
import {
  planTenantIdentityUpdate,
  type SocleOrgApi,
} from "../../../supabase/functions/sync-socle-referentiel/logic";

function makeRoot(overrides: Partial<SocleOrgApi> = {}): SocleOrgApi {
  return {
    id: "root",
    parent_id: null,
    name: "ACCM",
    slug: "accm",
    type: "collectivite",
    status: "active",
    phone: null,
    email: null,
    address: null,
    logo_url: "https://socle.example/accm.png",
    ...overrides,
  };
}

const CURRENT = {
  name: "ACCM",
  slug: "accm",
};

describe("planTenantIdentityUpdate", () => {
  it("retourne null quand nom et slug sont déjà alignés", () => {
    expect(planTenantIdentityUpdate(CURRENT, makeRoot())).toBeNull();
  });

  it("recopie nom et slug depuis l'organisation Socle mappée", () => {
    const current = { name: "Laurentville", slug: "laurentville" };
    expect(planTenantIdentityUpdate(current, makeRoot())).toEqual({
      name: "ACCM",
      slug: "accm",
    });
  });

  it("ne retourne que les champs qui changent", () => {
    const current = { ...CURRENT, name: "Laurentville" };
    expect(planTenantIdentityUpdate(current, makeRoot())).toEqual({ name: "ACCM" });
  });

  it("conserve le slug Clara si le Socle n'en fournit pas (contrainte NOT NULL/unicité)", () => {
    const current = { ...CURRENT, slug: "mon-slug" };
    expect(planTenantIdentityUpdate(current, makeRoot({ slug: null }))).toBeNull();
    expect(planTenantIdentityUpdate(current, makeRoot({ slug: "  " }))).toBeNull();
  });

  it("normalise le slug Socle en minuscules (contrainte organizations_slug_lowercase)", () => {
    expect(planTenantIdentityUpdate(CURRENT, makeRoot({ slug: " ACCM " }))).toBeNull();
    expect(planTenantIdentityUpdate(CURRENT, makeRoot({ slug: "Nouveau-Slug" }))).toEqual({
      slug: "nouveau-slug",
    });
  });

  it("ne touche PAS au logo : il appartient à la charte graphique (branding.ts)", () => {
    // `SocleOrgApi.logo_url` est la colonne brute de l'organisation. La reprendre
    // ici écraserait le logo hérité que /branding résout pour une
    // sous-organisation qui n'en porte pas.
    expect(planTenantIdentityUpdate(CURRENT, makeRoot({ logo_url: null }))).toBeNull();
    expect(planTenantIdentityUpdate(CURRENT, makeRoot({ logo_url: "https://autre.example/x.png" })))
      .toBeNull();
  });
});
