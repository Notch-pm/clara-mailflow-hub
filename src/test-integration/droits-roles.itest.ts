import { describe, it, expect, beforeAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clientAs, loadFixtures, type Fixtures } from "./helpers";

// ═══ Droits par rôle au sein d'un tenant : un `member` ne peut pas écrire les
// tables d'administration ; un `administrateur` le peut ; les miroirs Socle
// restent en lecture seule (seule la config Clara est modifiable, par un admin).

let fx: Fixtures;
let membreAlpha: SupabaseClient;
let adminAlpha: SupabaseClient;
let consultantAlpha: SupabaseClient;

beforeAll(async () => {
  fx = loadFixtures();
  membreAlpha = await clientAs(fx.users.membreAlpha, fx.password);
  adminAlpha = await clientAs(fx.users.adminAlpha, fx.password);
  consultantAlpha = await clientAs(fx.users.consultantAlpha, fx.password);
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

// ═══ Consultant : LECTURE SEULE. Lit tout son périmètre (is_member_of) mais
// n'écrit RIEN sur les tables opérationnelles (is_editor_of). Threat model :
// écriture hors UI (appel Supabase direct) refusée côté serveur.
describe("Consultant : lecture seule (is_editor_of)", () => {
  // AC-S2 — lecture autorisée (parité avec un éditeur)
  it("peut LIRE les courriers de son périmètre", async () => {
    const { data, error } = await consultantAlpha
      .from("couriers")
      .select("id")
      .eq("organization_id", fx.alpha.orgId);
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);
  });

  // AC-S1 — écritures opérationnelles refusées
  it("insert courier refusé", async () => {
    const { error } = await consultantAlpha.from("couriers").insert({
      organization_id: fx.alpha.orgId,
      direction: "inbound",
      channel: "paper",
      subject: "[TEST] courrier pirate consultant",
      received_at: new Date().toISOString(),
    });
    expect(error).not.toBeNull();
  });

  it("update courier refusé (0 ligne)", async () => {
    const { data } = await consultantAlpha
      .from("couriers")
      .update({ subject: "[TEST] hijack consultant" })
      .eq("id", fx.alpha.couriers.assigned)
      .select();
    expect(data ?? []).toEqual([]);
  });

  it("delete courier refusé (0 ligne)", async () => {
    const { data } = await consultantAlpha
      .from("couriers")
      .delete()
      .eq("id", fx.alpha.couriers.assigned)
      .select();
    expect(data ?? []).toEqual([]);
  });

  it("insert note interne refusé (CL-2 : la note est de la collaboration)", async () => {
    const { error } = await consultantAlpha.from("courier_notes").insert({
      organization_id: fx.alpha.orgId,
      courier_id: fx.alpha.couriers.assigned,
      content: "[TEST] note pirate consultant",
    });
    expect(error).not.toBeNull();
  });

  it("insert ticket d'action refusé", async () => {
    const { error } = await consultantAlpha.from("action_tickets").insert({
      organization_id: fx.alpha.orgId,
      courier_id: fx.alpha.couriers.assigned,
    });
    expect(error).not.toBeNull();
  });

  it("insert lien de courrier refusé", async () => {
    const { error } = await consultantAlpha.from("courier_links").insert({
      organization_id: fx.alpha.orgId,
      courier_id: fx.alpha.couriers.assigned,
      external_type: "iris",
      external_id: "[TEST]-PIRATE-1",
    });
    expect(error).not.toBeNull();
  });

  it("relance d'analyse IA (RPC enqueue_courier_analysis) refusée", async () => {
    const { error } = await consultantAlpha.rpc("enqueue_courier_analysis", {
      p_courier_id: fx.alpha.couriers.assigned,
      p_kind: "full",
    });
    expect(error).not.toBeNull(); // RAISE EXCEPTION 'Forbidden'
  });

  // AC-S7 — pas d'auto-escalade vers un rôle éditeur
  it("ne peut pas s'auto-promouvoir gestionnaire (éditeur)", async () => {
    const uid = (await consultantAlpha.auth.getUser()).data.user!.id;
    const { data } = await consultantAlpha
      .from("organization_users")
      .update({ role: "gestionnaire" })
      .eq("user_id", uid)
      .eq("organization_id", fx.alpha.orgId)
      .select();
    expect(data ?? []).toEqual([]);
  });

  // AC-S8 — isolation multi-tenant conservée
  it("ne lit AUCUN courrier du tenant Beta", async () => {
    const { data } = await consultantAlpha
      .from("couriers")
      .select("id")
      .eq("organization_id", fx.beta.orgId);
    expect(data ?? []).toEqual([]);
  });
});

// ═══ Non-régression is_editor_of : un membre NON-consultant garde l'écriture.
describe("Éditeur (rôle ≠ consultant) : écriture opérationnelle conservée", () => {
  it("membreAlpha peut créer puis supprimer une note", async () => {
    const { data, error } = await membreAlpha
      .from("courier_notes")
      .insert({
        organization_id: fx.alpha.orgId,
        courier_id: fx.alpha.couriers.assigned,
        content: "[TEST] note membre éditeur",
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    expect(data?.id).toBeTruthy();
    if (data?.id) {
      const { error: delErr } = await membreAlpha.from("courier_notes").delete().eq("id", data.id);
      expect(delErr).toBeNull();
    }
  });
});
