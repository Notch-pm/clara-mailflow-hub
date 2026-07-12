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
  logo_url: "https://socle.example/accm.png",
};

describe("planTenantIdentityUpdate", () => {
  it("retourne null quand nom, slug et logo sont déjà alignés", () => {
    expect(planTenantIdentityUpdate(CURRENT, makeRoot())).toBeNull();
  });

  it("recopie nom, slug et logo depuis la racine Socle", () => {
    const current = { name: "Laurentville", slug: "laurentville", logo_url: "https://old.example/logo.png" };
    expect(planTenantIdentityUpdate(current, makeRoot())).toEqual({
      name: "ACCM",
      slug: "accm",
      logo_url: "https://socle.example/accm.png",
    });
  });

  it("ne retourne que les champs qui changent", () => {
    const current = { ...CURRENT, logo_url: "https://old.example/logo.png" };
    expect(planTenantIdentityUpdate(current, makeRoot())).toEqual({
      logo_url: "https://socle.example/accm.png",
    });
  });

  it("efface le logo Clara si la racine Socle n'en a pas", () => {
    expect(planTenantIdentityUpdate(CURRENT, makeRoot({ logo_url: null }))).toEqual({
      logo_url: null,
    });
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

  it("gère un logo Clara null face à un logo Socle défini", () => {
    const current = { ...CURRENT, logo_url: null };
    expect(planTenantIdentityUpdate(current, makeRoot())).toEqual({
      logo_url: "https://socle.example/accm.png",
    });
  });
});
