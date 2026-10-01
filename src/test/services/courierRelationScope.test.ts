import { describe, expect, it } from "vitest";
import "../mocks/supabase";

const { scopeFilter } = await import("@/services/courierRelationService");

/**
 * Le filtre intra-tenant est UI-only : chaque requête de courriers doit borner
 * au périmètre de l'agent. Les suggestions de « Courriers liés » l'oubliaient
 * (E2E droits-membre, 2026-10-01).
 */
describe("scopeFilter", () => {
  it("administrateur (null) : aucune restriction", () => {
    expect(scopeFilter(null)).toBeNull();
    expect(scopeFilter(undefined)).toBeNull();
  });

  it("agent sans organisation : seulement les non assignés", () => {
    expect(scopeFilter([])).toBe("socle_organization_id.is.null");
  });

  it("agent : ses organisations + les non assignés", () => {
    expect(scopeFilter(["a", "b"])).toBe("socle_organization_id.is.null,socle_organization_id.in.(a,b)");
  });
});
