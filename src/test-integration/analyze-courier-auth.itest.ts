import { describe, it, expect, beforeAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anonClient, clientAs, loadFixtures, type Fixtures } from "./helpers";

// ═══ Non-régression AUTH d'analyze-courier (reliquat P0 #2 du plan QA).
// L'edge function tourne en service_role (bypass RLS) : sa sécurité est dans le
// code du handler. Contrat (analyze-courier/index.ts:793-828) :
//   x-org-id absent/invalide → 400 ; JWT absent/invalide → 401 « Unauthorized » ;
//   membre d'une autre org → 403 « Forbidden » ; consultant → 403 (assertEditor,
//   branche utilisateur SEULEMENT — le worker cron passe par x-cron-secret) ;
//   x-cron-secret erroné → 401. Un éditeur légitime passe l'auth et atteint le
//   routage (« Unknown action » 400 sans query) — contrôle positif SANS coût IA.
// On ne teste QUE des chemins de refus + ce 400 post-auth : aucun appel Mistral.

let fx: Fixtures;
let membreAlpha: SupabaseClient;
let consultantAlpha: SupabaseClient;
let adminBeta: SupabaseClient;

beforeAll(async () => {
  fx = loadFixtures();
  membreAlpha = await clientAs(fx.users.membreAlpha, fx.password);
  consultantAlpha = await clientAs(fx.users.consultantAlpha, fx.password);
  adminBeta = await clientAs(fx.users.adminBeta, fx.password);
});

/** Invoque analyze-courier et renvoie le statut HTTP (200 si succès). */
async function invokeStatus(
  client: SupabaseClient,
  headers: Record<string, string>,
): Promise<number> {
  const { error } = await client.functions.invoke("analyze-courier", {
    body: {},
    headers,
  });
  if (!error) return 200;
  const ctx = (error as { context?: { status?: number } }).context;
  return ctx?.status ?? -1;
}

describe("analyze-courier — refus d'auth (aucun coût IA)", () => {
  it("consultant → 403 (lecture seule : pas d'OCR/analyse à sa main)", async () => {
    expect(await invokeStatus(consultantAlpha, { "x-org-id": fx.alpha.orgId })).toBe(403);
  });

  it("membre d'un AUTRE tenant → 403", async () => {
    expect(await invokeStatus(adminBeta, { "x-org-id": fx.alpha.orgId })).toBe(403);
  });

  it("sans utilisateur (clé anon) → 401", async () => {
    expect(await invokeStatus(anonClient(), { "x-org-id": fx.alpha.orgId })).toBe(401);
  });

  it("x-cron-secret erroné → 401 (la branche worker exige le vrai secret)", async () => {
    expect(
      await invokeStatus(anonClient(), {
        "x-org-id": fx.alpha.orgId,
        "x-cron-secret": "[TEST] mauvais-secret",
      }),
    ).toBe(401);
  });

  it("x-org-id absent → 400", async () => {
    expect(await invokeStatus(membreAlpha, {})).toBe(400);
  });
});

describe("analyze-courier — contrôle positif", () => {
  it("un éditeur du tenant PASSE l'auth (400 « Unknown action », pas 401/403)", async () => {
    expect(await invokeStatus(membreAlpha, { "x-org-id": fx.alpha.orgId })).toBe(400);
  });
});
