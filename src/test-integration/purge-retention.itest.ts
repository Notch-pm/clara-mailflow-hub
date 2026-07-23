import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadFixtures, serviceRoleClient, type Fixtures } from "./helpers";

// ═══ Logique TEMPORELLE de la purge RGPD (reliquat P0 #4 du plan QA, dette P1.7).
// purge_expired_data() supprime les courriers d'une org dont
// last_activity_at = GREATEST(updated_at, max(events), max(notes)) est antérieur
// à now() - courier_retention_days. Exécutable uniquement en service_role
// (harnais : serviceRoleClient) ; updated_at est forcé par trigger sur UPDATE
// mais PAS sur INSERT → on backdate à l'insertion.
// Sûreté prod : AUCUNE organisation réelle n'a de rétention configurée
// (vérifié le 2026-07-23) — la rétention n'est posée que sur [TEST] Alpha,
// et remise à NULL en afterAll. La purge tourne de toute façon chaque nuit.

const svc = serviceRoleClient();
let fx: Fixtures;

const DAYS_40_AGO = new Date(Date.now() - 40 * 24 * 3600 * 1000).toISOString();

async function newCourier(
  client: SupabaseClient,
  orgId: string,
  subject: string,
  updatedAt: string | null,
): Promise<string> {
  const { data, error } = await client
    .from("couriers")
    .insert({
      organization_id: orgId,
      direction: "inbound",
      channel: "paper",
      subject,
      received_at: DAYS_40_AGO,
      ...(updatedAt ? { updated_at: updatedAt } : {}),
    })
    .select("id")
    .single();
  if (error) throw new Error(`insert ${subject}: ${error.message}`);
  return data!.id as string;
}

async function exists(client: SupabaseClient, id: string): Promise<boolean> {
  const { data } = await client.from("couriers").select("id").eq("id", id).maybeSingle();
  return !!data;
}

describe.skipIf(!svc)("purge_expired_data — logique temporelle par rétention", () => {
  let vieuxAlpha: string;
  let vieuxMaisActifAlpha: string;
  let recentAlpha: string;
  let vieuxBeta: string;

  beforeAll(async () => {
    fx = loadFixtures();
    // Rétention 30 j sur [TEST] Alpha uniquement ; Beta reste sans rétention.
    const { error } = await svc!
      .from("organizations")
      .update({ courier_retention_days: 30 })
      .eq("id", fx.alpha.orgId);
    if (error) throw new Error(`retention: ${error.message}`);

    vieuxAlpha = await newCourier(svc!, fx.alpha.orgId, "[TEST] purge vieux inactif", DAYS_40_AGO);
    vieuxMaisActifAlpha = await newCourier(svc!, fx.alpha.orgId, "[TEST] purge vieux mais actif", DAYS_40_AGO);
    recentAlpha = await newCourier(svc!, fx.alpha.orgId, "[TEST] purge récent", null);
    vieuxBeta = await newCourier(svc!, fx.beta.orgId, "[TEST] purge vieux beta", DAYS_40_AGO);

    // Activité récente sur le second : un courier_event d'aujourd'hui doit le sauver.
    const { error: evErr } = await svc!.from("courier_events").insert({
      organization_id: fx.alpha.orgId,
      courier_id: vieuxMaisActifAlpha,
      event_type: "note_added",
      payload: { test: true },
    });
    if (evErr) throw new Error(`event: ${evErr.message}`);
  });

  afterAll(async () => {
    // Toujours retirer la rétention de [TEST] Alpha et nettoyer les restes.
    await svc!.from("organizations").update({ courier_retention_days: null }).eq("id", fx.alpha.orgId);
    await svc!
      .from("couriers")
      .delete()
      .in("id", [vieuxMaisActifAlpha, recentAlpha, vieuxBeta].filter(Boolean));
  });

  it("purge le vieux inactif, épargne l'actif, le récent et l'org sans rétention", async () => {
    const { data, error } = await svc!.rpc("purge_expired_data");
    expect(error).toBeNull();

    const report = data as { deleted_couriers?: number } | null;
    expect(report?.deleted_couriers ?? 0).toBeGreaterThanOrEqual(1);

    // Cutoff 30 j : inactif depuis 40 j → supprimé
    expect(await exists(svc!, vieuxAlpha)).toBe(false);
    // Vieux mais avec un événement récent (last_activity = event) → conservé
    expect(await exists(svc!, vieuxMaisActifAlpha)).toBe(true);
    // Récent → conservé
    expect(await exists(svc!, recentAlpha)).toBe(true);
    // Org sans rétention (NULL) → jamais purgée, même vieille
    expect(await exists(svc!, vieuxBeta)).toBe(true);
  });

  it("un second passage est idempotent (rien de neuf à purger)", async () => {
    const { data, error } = await svc!.rpc("purge_expired_data");
    expect(error).toBeNull();
    // Les survivants du 1er passage survivent toujours
    expect(await exists(svc!, vieuxMaisActifAlpha)).toBe(true);
    expect(await exists(svc!, recentAlpha)).toBe(true);
    expect(await exists(svc!, vieuxBeta)).toBe(true);
    expect((data as { deleted_couriers?: number } | null)?.deleted_couriers ?? 0).toBe(0);
  });
});
