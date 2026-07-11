import { describe, expect, it } from "vitest";
import {
  countersFromOrgPlan,
  filterSubtree,
  mapSocleOrganization,
  planOrganizationSync,
  type OrgMirrorRow,
  type SocleOrgApi,
} from "../../../supabase/functions/sync-socle-referentiel/logic";

const T0 = "2026-07-11T15:00:00.000Z";

function makeOrg(overrides: Partial<SocleOrgApi> = {}): SocleOrgApi {
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
    logo_url: null,
    ...overrides,
  };
}

// Hiérarchie de test : root → (a → a1, b) ; other = hors sous-arbre
const ROOT = makeOrg();
const A = makeOrg({ id: "a", parent_id: "root", name: "Mairie A", slug: "a" });
const A1 = makeOrg({ id: "a1", parent_id: "a", name: "Service A1", slug: "a1" });
const B = makeOrg({ id: "b", parent_id: "root", name: "Mairie B", slug: "b" });
const OTHER = makeOrg({ id: "other", parent_id: null, name: "Autre racine", slug: "other" });

function mirrorRowFrom(org: SocleOrgApi, overrides: Partial<OrgMirrorRow> = {}): OrgMirrorRow {
  const mapped = mapSocleOrganization(org, T0);
  return { id: `row-${org.id}`, ...mapped, ...overrides } as OrgMirrorRow;
}

describe("filterSubtree", () => {
  it("garde la racine mappée et toute sa descendance, exclut le reste", () => {
    const result = filterSubtree([ROOT, A, A1, B, OTHER], "root");
    expect(result.map((o) => o.id).sort()).toEqual(["a", "a1", "b", "root"]);
  });

  it("un nœud feuille mappé donne un sous-arbre d'un seul élément", () => {
    const result = filterSubtree([ROOT, A, A1, B, OTHER], "a1");
    expect(result.map((o) => o.id)).toEqual(["a1"]);
  });

  it("neutralise le parent de la racine mappée (hors périmètre du tenant)", () => {
    const result = filterSubtree([ROOT, A, A1], "a");
    const root = result.find((o) => o.id === "a")!;
    expect(root.parent_id).toBeNull();
    expect(result.find((o) => o.id === "a1")!.parent_id).toBe("a");
  });

  it("racine introuvable → liste vide", () => {
    expect(filterSubtree([ROOT, A], "inconnu")).toEqual([]);
  });

  it("résiste aux cycles de parent_id", () => {
    const x = makeOrg({ id: "x", parent_id: "y", name: "X" });
    const y = makeOrg({ id: "y", parent_id: "x", name: "Y" });
    const root = makeOrg({ id: "r", name: "R" });
    const xChild = makeOrg({ id: "x", parent_id: "r", name: "X" });
    // x est enfant de r ET de y (données incohérentes) : pas de boucle infinie
    const result = filterSubtree([root, xChild, y, x], "r");
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(new Set(result.map((o) => o.id)).size).toBe(result.length); // pas de doublon
  });
});

describe("planOrganizationSync", () => {
  it("premier run : tout en insert", () => {
    const plan = planOrganizationSync([], [ROOT, A, B]);
    expect(plan.toInsert).toHaveLength(3);
    expect(plan.toUpdate).toHaveLength(0);
    expect(plan.toObsolete).toHaveLength(0);
    expect(countersFromOrgPlan(plan)).toMatchObject({ created: 3, unchanged: 0 });
  });

  it("second run identique : tout unchanged (idempotence)", () => {
    const subtree = filterSubtree([ROOT, A, A1, B, OTHER], "root");
    const existing = subtree.map((o) => mirrorRowFrom(o));
    const plan = planOrganizationSync(existing, subtree);
    expect(plan.toInsert).toHaveLength(0);
    expect(plan.toUpdate).toHaveLength(0);
    expect(plan.toObsolete).toHaveLength(0);
    expect(plan.unchanged).toBe(4);
  });

  it("détecte un changement de parent (déplacement dans l'arbre)", () => {
    const existing = [mirrorRowFrom(A1)];
    const moved = { ...A1, parent_id: "b" };
    const plan = planOrganizationSync(existing, [moved]);
    expect(plan.toUpdate).toHaveLength(1);
    expect(plan.toUpdate[0].existingId).toBe("row-a1");
  });

  it("détecte un changement de statut Socle (active → obsolete)", () => {
    const existing = [mirrorRowFrom(A)];
    const archived = { ...A, status: "obsolete" };
    const plan = planOrganizationSync(existing, [archived]);
    expect(plan.toUpdate).toHaveLength(1);
  });

  it("org disparue du périmètre → obsolète ; déjà obsolète → rien", () => {
    const existing = [mirrorRowFrom(A), mirrorRowFrom(B, { obsoleted_at: T0 })];
    const plan = planOrganizationSync(existing, []);
    expect(plan.toObsolete).toEqual(["row-a"]);
  });

  it("org réapparue → update (réactivation)", () => {
    const existing = [mirrorRowFrom(A, { obsoleted_at: T0 })];
    const plan = planOrganizationSync(existing, [A]);
    expect(plan.toUpdate).toHaveLength(1);
  });
});

describe("mapSocleOrganization", () => {
  it("mappe tous les champs et remet obsoleted_at à null", () => {
    const mapped = mapSocleOrganization(
      makeOrg({ phone: "0490000000", email: "contact@accm.fr", address: "1 place de la Mairie" }),
      T0,
    );
    expect(mapped).toMatchObject({
      socle_id: "root",
      socle_parent_id: null,
      name: "ACCM",
      status: "active",
      phone: "0490000000",
      email: "contact@accm.fr",
      synced_at: T0,
      obsoleted_at: null,
    });
  });
});
