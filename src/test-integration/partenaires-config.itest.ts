import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clientAs, loadFixtures, type Fixtures } from "./helpers";

// ═══ Intégration Partenaires — verrou superadmin de la config (lot L2).
// La config de connexion (organization_integrations) contient des SECRETS :
// écritures ET lecture réservées au superadmin (AC-SRV-1/2/3) ; le produit ne
// connaît l'état de l'interface que via le RPC partner_integration_status
// (configured/is_active, jamais de secret). Spec : docs/partenaires-integration.md.

let fx: Fixtures;
let adminAlpha: SupabaseClient;
let membreAlpha: SupabaseClient;
let adminBeta: SupabaseClient;
let superadmin: SupabaseClient;
let integrationId: string | null = null;

beforeAll(async () => {
  fx = loadFixtures();
  adminAlpha = await clientAs(fx.users.adminAlpha, fx.password);
  membreAlpha = await clientAs(fx.users.membreAlpha, fx.password);
  adminBeta = await clientAs(fx.users.adminBeta, fx.password);
  superadmin = await clientAs(fx.users.superadminTest, fx.password);
});

afterAll(async () => {
  if (integrationId) {
    await superadmin.from("organization_integrations").delete().eq("id", integrationId);
  }
});

describe("Config partenaire : superadmin uniquement", () => {
  it("AC-SRV-2 : le superadmin crée une intégration pour un tenant", async () => {
    const { data, error } = await superadmin
      .from("organization_integrations")
      .insert({
        organization_id: fx.alpha.orgId,
        provider: "arpege",
        api_base_url: "https://arpege.test.invalid",
        client_id: "[TEST] client",
        client_secret: "[TEST] secret",
        is_active: false,
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    integrationId = (data?.id as string) ?? null;
    expect(integrationId).toBeTruthy();
  });

  it("AC-SRV-1 : un admin de tenant ne peut PAS écrire la config", async () => {
    // INSERT refusé
    const { error: insErr } = await adminAlpha.from("organization_integrations").insert({
      organization_id: fx.alpha.orgId,
      provider: "autre-partenaire",
      api_base_url: "https://pirate.invalid",
    });
    expect(insErr).not.toBeNull();

    // UPDATE de la ligne existante : 0 ligne touchée
    const { data: updData } = await adminAlpha
      .from("organization_integrations")
      .update({ is_active: true })
      .eq("organization_id", fx.alpha.orgId)
      .select();
    expect(updData ?? []).toEqual([]);
  });

  it("AC-SRV-1bis : un admin de tenant ne LIT pas la config (secrets)", async () => {
    const { data } = await adminAlpha
      .from("organization_integrations")
      .select("id, client_secret")
      .eq("organization_id", fx.alpha.orgId);
    expect(data ?? []).toEqual([]);
  });

  it("AC-SRV-3 : aucun accès cross-tenant (admin Beta → config Alpha)", async () => {
    const { data } = await adminBeta.from("organization_integrations").select("id");
    expect(data ?? []).toEqual([]);
  });
});

describe("RPC partner_integration_status : statut sans secrets", () => {
  it("un membre du tenant lit configured/is_active", async () => {
    const { data, error } = await membreAlpha.rpc("partner_integration_status", {
      p_organization_id: fx.alpha.orgId,
      p_provider: "arpege",
    });
    expect(error).toBeNull();
    const rows = (data ?? []) as Array<{ configured: boolean; is_active: boolean }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].configured).toBe(true);
    expect(rows[0].is_active).toBe(false); // créée suspendue plus haut
  });

  it("un non-membre n'obtient rien (pas même configured)", async () => {
    const { data } = await adminBeta.rpc("partner_integration_status", {
      p_organization_id: fx.alpha.orgId,
      p_provider: "arpege",
    });
    expect(data ?? []).toEqual([]);
  });

  it("tenant sans intégration : configured=false (pas d'erreur)", async () => {
    const { data, error } = await adminBeta.rpc("partner_integration_status", {
      p_organization_id: fx.beta.orgId,
      p_provider: "arpege",
    });
    expect(error).toBeNull();
    const rows = (data ?? []) as Array<{ configured: boolean; is_active: boolean }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].configured).toBe(false);
    expect(rows[0].is_active).toBe(false);
  });
});
