import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clientAs, loadFixtures, serviceRoleClient, type Fixtures } from "./helpers";

// ═══ Intégration Partenaires — verrou superadmin de la config (lot L2).
// La config de connexion (organization_integrations) contient des SECRETS :
// écritures ET lecture réservées au superadmin (AC-SRV-1/2/3) ; le produit ne
// connaît l'état de l'interface que via le RPC partner_integration_status
// (configured/is_active, jamais de secret). Spec : docs/partenaires-integration.md.
//
// Depuis le 2026-10-02, les lignes Arpège viennent du Socle et ne s'écrivent
// plus que par le service role (sync du référentiel) : même le superadmin ne
// peut plus les créer ni les modifier. Les autres providers (Iris) restent
// saisis par le superadmin — c'est sur une ligne Iris que portent les tests
// d'écriture superadmin.

let fx: Fixtures;
let adminAlpha: SupabaseClient;
let membreAlpha: SupabaseClient;
let adminBeta: SupabaseClient;
let superadmin: SupabaseClient;
let integrationId: string | null = null;
let arpegeId: string | null = null;
const svc = serviceRoleClient();

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
  if (arpegeId && svc) {
    await svc.from("organization_integrations").delete().eq("id", arpegeId);
  }
});

describe("Config partenaire : superadmin uniquement", () => {
  it("AC-SRV-2 : le superadmin crée une intégration pour un tenant", async () => {
    const { data, error } = await superadmin
      .from("organization_integrations")
      .insert({
        organization_id: fx.alpha.orgId,
        provider: "iris",
        api_base_url: "https://iris.test.invalid",
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

  it("AC-SRV-4 : le superadmin ne peut PAS créer de ligne Arpège (le Socle fait foi)", async () => {
    const { error } = await superadmin.from("organization_integrations").insert({
      organization_id: fx.beta.orgId,
      provider: "arpege",
      api_base_url: "https://arpege.test.invalid",
      client_id: "[TEST] client",
      client_secret: "[TEST] secret",
    });
    expect(error).not.toBeNull();
  });

  it("AC-SRV-4bis : le superadmin ne peut PAS renommer une ligne en Arpège", async () => {
    const { data } = await superadmin
      .from("organization_integrations")
      .update({ provider: "arpege" })
      .eq("id", integrationId!)
      .select("id");
    expect(data ?? []).toEqual([]);
  });

  it.skipIf(!svc)("AC-SRV-4ter : le superadmin ne modifie ni ne supprime une ligne Arpège recopiée", async () => {
    const { data: created, error } = await svc!
      .from("organization_integrations")
      .insert({
        organization_id: fx.beta.orgId,
        provider: "arpege",
        api_base_url: "https://arpege.test.invalid",
        client_id: "[TEST] client",
        client_secret: "[TEST] secret",
        is_active: true,
        socle_synced_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    arpegeId = (created?.id as string) ?? null;

    const { data: upd } = await superadmin
      .from("organization_integrations")
      .update({ is_active: false })
      .eq("id", arpegeId!)
      .select("id");
    expect(upd ?? []).toEqual([]);

    const { data: del } = await superadmin
      .from("organization_integrations")
      .delete()
      .eq("id", arpegeId!)
      .select("id");
    expect(del ?? []).toEqual([]);

    // La lecture reste ouverte au superadmin (écran Intégrations).
    const { data: lu } = await superadmin
      .from("organization_integrations")
      .select("id, is_active")
      .eq("id", arpegeId!);
    expect(lu).toEqual([{ id: arpegeId, is_active: true }]);
  });

  it.skipIf(!svc)("suspend_arpege_integration_from_socle : suspend sans effacer les identifiants", async () => {
    const { data: suspendu, error } = await svc!.rpc("suspend_arpege_integration_from_socle", {
      p_org_id: fx.beta.orgId,
    });
    expect(error).toBeNull();
    expect(suspendu).toBe(true);

    const { data: ligne } = await svc!
      .from("organization_integrations")
      .select("is_active, client_id, client_secret, api_base_url")
      .eq("id", arpegeId!)
      .single();
    expect(ligne).toEqual({
      is_active: false,
      client_id: "[TEST] client",
      client_secret: "[TEST] secret",
      api_base_url: "https://arpege.test.invalid",
    });

    // Déjà suspendue : rien à compter.
    const { data: encore } = await svc!.rpc("suspend_arpege_integration_from_socle", {
      p_org_id: fx.beta.orgId,
    });
    expect(encore).toBe(false);
  });

  it("la RPC de suspension est fermée aux utilisateurs", async () => {
    const { error } = await superadmin.rpc("suspend_arpege_integration_from_socle", {
      p_org_id: fx.alpha.orgId,
    });
    expect(error).not.toBeNull();
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
      p_provider: "iris",
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
      p_provider: "iris",
    });
    expect(data ?? []).toEqual([]);
  });

  it("tenant sans intégration : configured=false (pas d'erreur)", async () => {
    const { data, error } = await adminBeta.rpc("partner_integration_status", {
      p_organization_id: fx.beta.orgId,
      p_provider: "iris",
    });
    expect(error).toBeNull();
    const rows = (data ?? []) as Array<{ configured: boolean; is_active: boolean }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].configured).toBe(false);
    expect(rows[0].is_active).toBe(false);
  });
});
