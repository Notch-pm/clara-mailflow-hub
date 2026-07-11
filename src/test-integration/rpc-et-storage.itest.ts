import { describe, it, expect, beforeAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anonClient, clientAs, loadFixtures, type Fixtures } from "./helpers";

// ═══ Surface RPC et Storage : les fonctions SQL et les buckets respectent la
// même isolation que les tables.

let fx: Fixtures;
let membreAlpha: SupabaseClient;

beforeAll(async () => {
  fx = loadFixtures();
  membreAlpha = await clientAs(fx.users.membreAlpha, fx.password);
});

describe("RPC search_couriers", () => {
  it("sur son propre tenant : renvoie les courriers [TEST] Alpha", async () => {
    const { data, error } = await membreAlpha.rpc("search_couriers", {
      p_organization_id: fx.alpha.orgId,
      p_limit: 50,
    });
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it("sur le tenant Beta : aucune ligne (garde is_member_of)", async () => {
    const { data, error } = await membreAlpha.rpc("search_couriers", {
      p_organization_id: fx.beta.orgId,
      p_limit: 50,
    });
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });

  it("anonyme : EXECUTE révoqué (migration security_hardening_p0)", async () => {
    const { error } = await anonClient().rpc("search_couriers", {
      p_organization_id: fx.alpha.orgId,
    });
    expect(error).not.toBeNull();
  });
});

describe("RPC stats_* (SECURITY INVOKER : la RLS s'applique)", () => {
  it("stats_inbound_by_month sur le tenant Beta : 0 ligne", async () => {
    const { data, error } = await membreAlpha.rpc("stats_inbound_by_month", {
      p_org_id: fx.beta.orgId,
      p_months: 12,
    });
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });

  it("stats_by_service sur le tenant Beta : 0 ligne", async () => {
    const { data, error } = await membreAlpha.rpc("stats_by_service", {
      p_org_id: fx.beta.orgId,
      p_direction: "inbound",
    });
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });

  it("stats_inbound_by_month sur son tenant : données présentes (sanity)", async () => {
    const { data, error } = await membreAlpha.rpc("stats_inbound_by_month", {
      p_org_id: fx.alpha.orgId,
      p_months: 12,
    });
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThanOrEqual(1);
  });
});

describe("RPC sensibles", () => {
  it("get_cron_secret inaccessible aux utilisateurs", async () => {
    const { data, error } = await membreAlpha.rpc("get_cron_secret");
    expect(error).not.toBeNull();
    expect(data ?? null).toBeNull();
  });
});

describe("Storage clara-documents (dossier = organization_id)", () => {
  const content = new Blob(["[TEST] contenu"], { type: "text/plain" });

  it("upload dans le dossier de SON org : autorisé (puis nettoyé)", async () => {
    const path = `${fx.alpha.orgId}/itest-own.txt`;
    const { error } = await membreAlpha.storage.from("clara-documents").upload(path, content, { upsert: true });
    expect(error).toBeNull();
    await membreAlpha.storage.from("clara-documents").remove([path]);
  });

  it("upload dans le dossier du tenant Beta : refusé", async () => {
    const { error } = await membreAlpha.storage
      .from("clara-documents")
      .upload(`${fx.beta.orgId}/itest-intrusion.txt`, content, { upsert: true });
    expect(error).not.toBeNull();
  });

  it("listing du dossier Beta : vide", async () => {
    const { data } = await membreAlpha.storage.from("clara-documents").list(fx.beta.orgId);
    expect(data ?? []).toEqual([]);
  });
});
