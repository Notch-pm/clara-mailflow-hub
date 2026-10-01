import { describe, it, expect, beforeAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anonClient, clientAs, loadFixtures, type Fixtures } from "./helpers";

// ═══ Isolation multi-tenant : un utilisateur ne voit JAMAIS les données d'un
// autre tenant, quelle que soit la table ou la méthode d'accès. Toute fuite
// détectée ici est une régression critique (docs/security.md).

let fx: Fixtures;
let membreAlpha: SupabaseClient;
let adminAlpha: SupabaseClient;
let membreBeta: SupabaseClient;

beforeAll(async () => {
  fx = loadFixtures();
  membreAlpha = await clientAs(fx.users.membreAlpha, fx.password);
  adminAlpha = await clientAs(fx.users.adminAlpha, fx.password);
  membreBeta = await clientAs(fx.users.membreBeta, fx.password);
});

// Tables métier lisibles par un simple membre (policy is_member_of)
const MEMBER_READABLE_TABLES = [
  "couriers",
  "courier_tags",
  "workflows",
  "workflow_states",
  "socle_organizations",
  "socle_categories",
  "socle_document_types",
  "socle_organization_members",
  "socle_organization_signatories",
  "socle_organization_viseurs",
  "courier_visas",
  "signatories",
  "procedures",
  "socle_sync_runs",
];

describe("Isolation en lecture (membre Alpha → données Beta)", () => {
  for (const table of MEMBER_READABLE_TABLES) {
    it(`${table} : 0 ligne du tenant Beta`, async () => {
      const { data, error } = await membreAlpha
        .from(table)
        .select("id, organization_id")
        .eq("organization_id", fx.beta.orgId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it(`${table} : un select global ne remonte aucune ligne Beta`, async () => {
      const { data, error } = await membreAlpha
        .from(table)
        .select("organization_id")
        .limit(1000);
      expect(error).toBeNull();
      const orgIds = new Set((data ?? []).map((r) => r.organization_id));
      expect(orgIds.has(fx.beta.orgId)).toBe(false);
    });
  }

  it("couriers : membre Alpha voit bien les courriers de SON tenant (sanity)", async () => {
    const { data, error } = await membreAlpha
      .from("couriers")
      .select("id")
      .eq("organization_id", fx.alpha.orgId);
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it("organizations : membre Alpha ne voit pas le tenant Beta", async () => {
    const { data } = await membreAlpha.from("organizations").select("id");
    const ids = new Set((data ?? []).map((r) => r.id));
    expect(ids.has(fx.alpha.orgId)).toBe(true);
    expect(ids.has(fx.beta.orgId)).toBe(false);
  });

  it("accès direct par id : le courrier Beta est invisible (pas d'oracle par id)", async () => {
    const { data, error } = await membreAlpha
      .from("couriers")
      .select("*")
      .eq("id", fx.beta.couriers.root)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data).toBeNull();
  });
});

describe("Isolation en écriture (cross-tenant rejeté)", () => {
  it("insert d'un courrier dans le tenant Beta → rejeté (membre ET admin Alpha)", async () => {
    for (const client of [membreAlpha, adminAlpha]) {
      const { data, error } = await client
        .from("couriers")
        .insert({
          organization_id: fx.beta.orgId,
          direction: "inbound",
          channel: "paper",
          subject: "[TEST] tentative cross-tenant",
          received_at: new Date().toISOString(),
        })
        .select();
      expect(error).not.toBeNull();
      expect(data).toBeNull();
    }
  });

  it("update d'un courrier Beta → 0 ligne affectée", async () => {
    const { data, error } = await adminAlpha
      .from("couriers")
      .update({ subject: "[TEST] piraté" })
      .eq("id", fx.beta.couriers.root)
      .select();
    expect(error).toBeNull(); // RLS filtre silencieusement
    expect(data).toEqual([]);
    // Contre-vérification côté Beta : sujet intact
    const { data: check } = await membreBeta
      .from("couriers")
      .select("subject")
      .eq("id", fx.beta.couriers.root)
      .single();
    expect(check?.subject).toBe("[TEST] Courrier Beta racine");
  });

  it("delete d'un courrier Beta → 0 ligne affectée", async () => {
    const { data, error } = await adminAlpha
      .from("couriers")
      .delete()
      .eq("id", fx.beta.couriers.unassigned)
      .select();
    expect(error).toBeNull();
    expect(data).toEqual([]);
    const { data: still } = await membreBeta
      .from("couriers")
      .select("id")
      .eq("id", fx.beta.couriers.unassigned)
      .single();
    expect(still?.id).toBe(fx.beta.couriers.unassigned);
  });

  it("update de l'organisation Beta (socle_org_id, rétention…) → rejeté", async () => {
    const { data } = await adminAlpha
      .from("organizations")
      .update({ name: "[TEST] piraté" })
      .eq("id", fx.beta.orgId)
      .select();
    expect(data).toEqual([]);
  });
});

describe("Anonyme : aucune donnée accessible", () => {
  it("couriers/organizations/socle_organizations : 0 ligne sans authentification", async () => {
    const anon = anonClient();
    for (const table of ["couriers", "organizations", "socle_organizations"]) {
      const { data } = await anon.from(table).select("*").limit(10);
      expect(data ?? []).toEqual([]);
    }
  });
});
