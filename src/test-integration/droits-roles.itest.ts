import { describe, it, expect, beforeAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clientAs, loadFixtures, type Fixtures } from "./helpers";

// ═══ Droits par rôle au sein d'un tenant : un `member` ne peut pas écrire les
// tables d'administration ; un `administrateur` le peut ; les miroirs Socle
// restent en lecture seule (seule la config Clara est modifiable, par un admin).

let fx: Fixtures;
let membreAlpha: SupabaseClient;
let adminAlpha: SupabaseClient;

beforeAll(async () => {
  fx = loadFixtures();
  membreAlpha = await clientAs(fx.users.membreAlpha, fx.password);
  adminAlpha = await clientAs(fx.users.adminAlpha, fx.password);
});

describe("Membre : écritures d'administration refusées", () => {
  it("insert courier_tags refusé", async () => {
    const { error } = await membreAlpha
      .from("courier_tags")
      .insert({ organization_id: fx.alpha.orgId, name: "[TEST] tag pirate", color: "#000" });
    expect(error).not.toBeNull();
  });

  it("insert workflows refusé", async () => {
    const { error } = await membreAlpha
      .from("workflows")
      .insert({ organization_id: fx.alpha.orgId, name: "[TEST] wf pirate", type: "inbound" });
    expect(error).not.toBeNull();
  });

  it("update de la config d'une organisation (workflow) refusé", async () => {
    const { data } = await membreAlpha
      .from("socle_organizations")
      .update({ workflow_id: null })
      .eq("id", fx.alpha.rootSocleOrgId)
      .select();
    expect(data).toEqual([]);
  });

  it("gestion des membres d'organisation refusée", async () => {
    const { error } = await membreAlpha.from("socle_organization_members").insert({
      organization_id: fx.alpha.orgId,
      socle_organization_id: fx.alpha.rootSocleOrgId,
      user_id: (await membreAlpha.auth.getUser()).data.user!.id,
    });
    expect(error).not.toBeNull();
  });

  it("update imap_settings refusé (et lecture réservée aux admins)", async () => {
    const { data: rows } = await membreAlpha
      .from("imap_settings")
      .select("id")
      .eq("organization_id", fx.alpha.orgId);
    expect(rows ?? []).toEqual([]); // policy de lecture admin-only
  });
});

describe("Admin : écritures d'administration autorisées (sur SON tenant)", () => {
  it("insert + delete courier_tags OK", async () => {
    const { data, error } = await adminAlpha
      .from("courier_tags")
      .insert({ organization_id: fx.alpha.orgId, name: "[TEST] tag admin", color: "#111" })
      .select("id")
      .single();
    expect(error).toBeNull();
    const { error: delErr } = await adminAlpha.from("courier_tags").delete().eq("id", data!.id);
    expect(delErr).toBeNull();
  });

  it("update de la config Clara d'une organisation OK (workflow réponse)", async () => {
    const { error } = await adminAlpha
      .from("socle_organizations")
      .update({ reply_workflow_id: fx.alpha.replyWorkflowId })
      .eq("id", fx.alpha.rootSocleOrgId);
    expect(error).toBeNull();
  });

  it("insert/delete dans le miroir socle_organizations refusés MÊME pour un admin", async () => {
    const { error: insErr } = await adminAlpha.from("socle_organizations").insert({
      organization_id: fx.alpha.orgId,
      socle_id: crypto.randomUUID(),
      name: "[TEST] org pirate",
      status: "active",
    });
    expect(insErr).not.toBeNull();

    const { data: delData } = await adminAlpha
      .from("socle_organizations")
      .delete()
      .eq("id", fx.alpha.subSocleOrgId)
      .select();
    expect(delData).toEqual([]);
  });
});

describe("Garde-fous d'escalade", () => {
  it("auto-promotion is_superadmin bloquée (trigger + policy)", async () => {
    const uid = (await membreAlpha.auth.getUser()).data.user!.id;
    const { data } = await membreAlpha
      .from("users")
      .update({ is_superadmin: true })
      .eq("id", uid)
      .select();
    // Soit erreur (trigger), soit 0 ligne (policy WITH CHECK) — jamais de succès
    expect(data ?? []).toEqual([]);

    const { data: check } = await adminAlpha.from("users").select("is_superadmin").eq("id", uid).maybeSingle();
    expect(check?.is_superadmin ?? false).toBe(false);
  });

  it("un membre ne peut pas s'auto-promouvoir administrateur", async () => {
    const uid = (await membreAlpha.auth.getUser()).data.user!.id;
    const { data } = await membreAlpha
      .from("organization_users")
      .update({ role: "administrateur" })
      .eq("user_id", uid)
      .eq("organization_id", fx.alpha.orgId)
      .select();
    expect(data ?? []).toEqual([]);
  });
});
