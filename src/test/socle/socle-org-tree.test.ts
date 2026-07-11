import { describe, expect, it } from "vitest";
import { buildSocleOrgTree, flattenSocleOrgTree } from "@/lib/socleOrgTree";
import type { SocleOrgMirror } from "@/services/socleSyncService";

function makeMirror(overrides: Partial<SocleOrgMirror> = {}): SocleOrgMirror {
  return {
    id: "row-1",
    organization_id: "clara-org",
    socle_id: "s-1",
    socle_parent_id: null,
    name: "ACCM",
    slug: null,
    type: null,
    status: "active",
    phone: null,
    email: null,
    address: null,
    logo_url: null,
    synced_at: "2026-07-11T15:00:00.000Z",
    obsoleted_at: null,
    ...overrides,
  };
}

const ROOT = makeMirror({ id: "r", socle_id: "root", name: "ACCM" });
const B = makeMirror({ id: "b", socle_id: "sb", socle_parent_id: "root", name: "Mairie B" });
const A = makeMirror({ id: "a", socle_id: "sa", socle_parent_id: "root", name: "Mairie A" });
const A1 = makeMirror({ id: "a1", socle_id: "sa1", socle_parent_id: "sa", name: "Service A1" });

describe("buildSocleOrgTree", () => {
  it("construit l'arbre via socle_parent_id, trié par nom, avec depth", () => {
    const roots = buildSocleOrgTree([B, A1, ROOT, A]);

    expect(roots).toHaveLength(1);
    expect(roots[0].name).toBe("ACCM");
    expect(roots[0].depth).toBe(1);
    expect(roots[0].children.map((c) => c.name)).toEqual(["Mairie A", "Mairie B"]);
    expect(roots[0].children[0].children[0]).toMatchObject({ name: "Service A1", depth: 3 });
  });

  it("un parent hors périmètre fait du nœud une racine de forêt", () => {
    const orphan = makeMirror({
      id: "o",
      socle_id: "so",
      socle_parent_id: "hors-perimetre",
      name: "Orpheline",
    });
    const roots = buildSocleOrgTree([ROOT, orphan]);
    expect(roots.map((r) => r.name)).toEqual(["ACCM", "Orpheline"]);
  });

  it("liste vide → forêt vide", () => {
    expect(buildSocleOrgTree([])).toEqual([]);
  });
});

describe("flattenSocleOrgTree", () => {
  it("aplatit en parcours préfixe (parent avant enfants)", () => {
    const flat = flattenSocleOrgTree(buildSocleOrgTree([B, A1, ROOT, A]));
    expect(flat.map((n) => n.name)).toEqual(["ACCM", "Mairie A", "Service A1", "Mairie B"]);
    expect(flat.map((n) => n.depth)).toEqual([1, 2, 3, 2]);
  });
});
