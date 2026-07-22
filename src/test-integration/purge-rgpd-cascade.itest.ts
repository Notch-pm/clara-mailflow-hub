import { describe, it, expect, beforeAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clientAs, loadFixtures, type Fixtures } from "./helpers";

// ═══ Purge RGPD : la suppression d'un courrier doit emporter TOUTES ses données
// personnelles dérivées. Régression ciblée : `courier_analyses` (résumé/intentions
// IA) et `courier_document_extracts` (texte OCR des pièces jointes) n'avaient
// AUCUNE FK vers `couriers` → elles survivaient orphelines à la purge nocturne.
// Ce test prouve la cascade ajoutée par 20260722205016_purge_rgpd_fk_cascade.sql.
//
// NB : la logique temporelle de `purge_expired_data()` (cutoff par rétention) n'est
// PAS testée ici — la fonction n'est exécutable que par service_role et `updated_at`
// est forcé par trigger, ce qui exige un harnais service_role (cf. docs/technical-debt).
// On teste la mécanique DB (le DELETE d'un courrier), qui est ce que la purge déclenche.

let fx: Fixtures;
let adminAlpha: SupabaseClient;

beforeAll(async () => {
  fx = loadFixtures();
  adminAlpha = await clientAs(fx.users.adminAlpha, fx.password);
});

describe("Purge RGPD : cascade des données dérivées d'un courrier", () => {
  it("supprimer un courrier emporte son analyse IA et ses extraits OCR", async () => {
    // 1. Créer un courrier jetable dans le tenant Alpha
    const { data: courier, error: cErr } = await adminAlpha
      .from("couriers")
      .insert({
        organization_id: fx.alpha.orgId,
        direction: "inbound",
        channel: "paper",
        subject: "[TEST] courrier purge-cascade",
        received_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    expect(cErr).toBeNull();
    const courierId = courier!.id as string;

    // 2. Y rattacher des données personnelles dérivées
    const { error: aErr } = await adminAlpha.from("courier_analyses").insert({
      courier_id: courierId,
      organization_id: fx.alpha.orgId,
    });
    expect(aErr).toBeNull();

    const { error: eErr } = await adminAlpha.from("courier_document_extracts").insert({
      courier_id: courierId,
      organization_id: fx.alpha.orgId,
      document_id: crypto.randomUUID(), // pas de FK sur document_id : uuid factice accepté
      text: "[TEST] texte OCR sensible",
    });
    expect(eErr).toBeNull();

    // 3. Elles existent bien avant suppression
    const before = await Promise.all([
      adminAlpha.from("courier_analyses").select("id").eq("courier_id", courierId),
      adminAlpha.from("courier_document_extracts").select("id").eq("courier_id", courierId),
    ]);
    expect((before[0].data ?? []).length).toBe(1);
    expect((before[1].data ?? []).length).toBe(1);

    // 4. Supprimer le courrier (ce que déclenche la purge nocturne)
    const { error: dErr } = await adminAlpha.from("couriers").delete().eq("id", courierId);
    expect(dErr).toBeNull();

    // 5. Analyse ET extraits ont disparu en cascade — plus d'orphelin RGPD
    const after = await Promise.all([
      adminAlpha.from("courier_analyses").select("id").eq("courier_id", courierId),
      adminAlpha.from("courier_document_extracts").select("id").eq("courier_id", courierId),
    ]);
    expect(after[0].data ?? []).toEqual([]);
    expect(after[1].data ?? []).toEqual([]);
  });
});
