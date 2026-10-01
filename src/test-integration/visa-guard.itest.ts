import { describe, it, expect, beforeAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clientAs, loadFixtures, serviceRoleClient, type Fixtures } from "./helpers";

// ═══ Garde serveur du VISA (migration 20261001140000_visa_reponses.sql).
// - courier_visas_validate : seul un viseur (organization_users.is_viseur) lié à
//   l'organisation gestionnaire (socle_organization_viseurs) vise, et seulement
//   l'étape de visa où se trouve la réponse ; une étape déjà visée ne l'est pas
//   deux fois. La trace est immuable (aucune policy UPDATE/DELETE).
// - couriers_enforce_visa : on ne quitte pas une étape de visa vers l'avant sans
//   visa en vigueur ; retour (previous / initial) et abandon (final non traité)
//   restent libres.
// - couriers_supersede_visas : revenir dans l'étape périme le visa précédent.
// Fixture : viseur.alpha lié à la RACINE Socle d'Alpha (pas au Cabinet) ;
// workflow réponse En rédaction → À viser → À signer (+ Renvoyer / Abandonner /
// Terminer sans signature).

let fx: Fixtures;
let adminAlpha: SupabaseClient;
let membreAlpha: SupabaseClient;
let viseurAlpha: SupabaseClient;
const svc = serviceRoleClient();

beforeAll(async () => {
  fx = loadFixtures();
  adminAlpha = await clientAs(fx.users.adminAlpha, fx.password);
  membreAlpha = await clientAs(fx.users.membreAlpha, fx.password);
  viseurAlpha = await clientAs(fx.users.viseurAlpha, fx.password);
});

/** Crée un courrier parent (sorti de la boîte aux lettres : en instruction) + une réponse rattachée à l'org donnée, placée à l'étape de visa. */
async function newReplyInVisa(socleOrgId: string): Promise<string> {
  const { data: parent, error: pErr } = await adminAlpha
    .from("couriers")
    .insert({
      organization_id: fx.alpha.orgId,
      direction: "inbound",
      channel: "paper",
      subject: "[TEST] parent visa-guard",
      received_at: new Date().toISOString(),
      socle_organization_id: socleOrgId,
      workflow_state_id: fx.alpha.states.initial,
    })
    .select("id")
    .single();
  if (pErr) throw new Error(`parent: ${pErr.message}`);
  // Une réponse ne naît que d'un courrier sorti de la boîte aux lettres.
  const instruct = await moveTo(adminAlpha, parent!.id as string, fx.alpha.states.processing);
  if (instruct.error) throw new Error(`instruction du parent: ${instruct.error.message}`);

  const { data: reply, error: rErr } = await adminAlpha
    .from("couriers")
    .insert({
      organization_id: fx.alpha.orgId,
      direction: "outbound",
      channel: "paper",
      subject: "[TEST] réponse visa-guard",
      sent_at: new Date().toISOString(),
      parent_courier_id: parent!.id,
      socle_organization_id: socleOrgId,
      workflow_state_id: fx.alpha.replyStates.initial,
      metadata: { body_html: "<p>Brouillon</p>" },
    })
    .select("id")
    .single();
  if (rErr) throw new Error(`réponse: ${rErr.message}`);

  const moved = await moveTo(adminAlpha, reply!.id as string, fx.alpha.replyStates.visa);
  if (moved.error) throw new Error(`passage en visa: ${moved.error.message}`);
  return reply!.id as string;
}

function moveTo(client: SupabaseClient, replyId: string, stateId: string) {
  return client.from("couriers").update({ workflow_state_id: stateId }).eq("id", replyId).select("id");
}

function visa(client: SupabaseClient, replyId: string, stateId = fx.alpha.replyStates.visa) {
  return client
    .from("courier_visas")
    .insert({ organization_id: fx.alpha.orgId, courier_id: replyId, workflow_state_id: stateId, comment: "[TEST] vu" })
    .select("id, superseded_at")
    .single();
}

async function activeVisas(replyId: string) {
  const { data } = await adminAlpha
    .from("courier_visas")
    .select("id, superseded_at")
    .eq("courier_id", replyId);
  return (data ?? []) as { id: string; superseded_at: string | null }[];
}

describe("Garde de visa — refus serveur", () => {
  it("un éditeur NON viseur ne peut pas viser", async () => {
    const id = await newReplyInVisa(fx.alpha.rootSocleOrgId);
    const { error } = await visa(membreAlpha, id);
    expect(error).not.toBeNull();
  });

  it("un admin NON viseur ne peut pas viser non plus", async () => {
    const id = await newReplyInVisa(fx.alpha.rootSocleOrgId);
    const { error } = await visa(adminAlpha, id);
    expect(error).not.toBeNull();
  });

  it("le viseur de la RACINE ne vise pas une réponse du Cabinet (par organisation)", async () => {
    const id = await newReplyInVisa(fx.alpha.subSocleOrgId);
    const { error } = await visa(viseurAlpha, id);
    expect(error).not.toBeNull();
  });

  it("on ne vise pas une étape où la réponse ne se trouve pas", async () => {
    const id = await newReplyInVisa(fx.alpha.rootSocleOrgId);
    const { error } = await visa(viseurAlpha, id, fx.alpha.replyStates.signature);
    expect(error).not.toBeNull();
  });

  it("on ne vise pas une étape qui n'est pas une étape de visa", async () => {
    const id = await newReplyInVisa(fx.alpha.rootSocleOrgId);
    expect((await moveTo(adminAlpha, id, fx.alpha.replyStates.initial)).error).toBeNull();
    const { error } = await visa(viseurAlpha, id, fx.alpha.replyStates.initial);
    expect(error).not.toBeNull();
  });

  it("une étape déjà visée ne se vise pas deux fois", async () => {
    const id = await newReplyInVisa(fx.alpha.rootSocleOrgId);
    expect((await visa(viseurAlpha, id)).error).toBeNull();
    expect((await visa(viseurAlpha, id)).error).not.toBeNull();
  });

  it("sortir de l'étape vers l'avant SANS visa est refusé", async () => {
    const id = await newReplyInVisa(fx.alpha.rootSocleOrgId);
    const { error } = await moveTo(adminAlpha, id, fx.alpha.replyStates.signature);
    expect(error).not.toBeNull();
  });

  it("terminer (final traité) SANS visa est refusé", async () => {
    const id = await newReplyInVisa(fx.alpha.rootSocleOrgId);
    const { error } = await moveTo(adminAlpha, id, fx.alpha.replyStates.final);
    expect(error).not.toBeNull();
  });

  it("la trace est immuable : ni UPDATE ni DELETE", async () => {
    const id = await newReplyInVisa(fx.alpha.rootSocleOrgId);
    const { data: v } = await visa(viseurAlpha, id);
    const upd = await viseurAlpha.from("courier_visas").update({ comment: "falsifié" }).eq("id", v!.id).select("id");
    expect(upd.data ?? []).toEqual([]);
    const del = await adminAlpha.from("courier_visas").delete().eq("id", v!.id).select("id");
    expect(del.data ?? []).toEqual([]);
    expect(await activeVisas(id)).toHaveLength(1);
  });
});

describe("Garde de visa — flux légitimes", () => {
  it("le viseur vise, puis la réponse avance", async () => {
    const id = await newReplyInVisa(fx.alpha.rootSocleOrgId);
    expect((await visa(viseurAlpha, id)).error).toBeNull();
    expect((await moveTo(adminAlpha, id, fx.alpha.replyStates.signature)).error).toBeNull();
  });

  it("le renvoi en rédaction (previous) reste libre sans visa", async () => {
    const id = await newReplyInVisa(fx.alpha.rootSocleOrgId);
    expect((await moveTo(adminAlpha, id, fx.alpha.replyStates.initial)).error).toBeNull();
  });

  it("l'abandon (final non traité) reste libre sans visa", async () => {
    const id = await newReplyInVisa(fx.alpha.rootSocleOrgId);
    expect((await moveTo(adminAlpha, id, fx.alpha.replyStates.abandon)).error).toBeNull();
  });

  it("revenir dans l'étape périme l'ancien visa et en exige un nouveau", async () => {
    const id = await newReplyInVisa(fx.alpha.rootSocleOrgId);
    expect((await visa(viseurAlpha, id)).error).toBeNull();
    expect((await moveTo(adminAlpha, id, fx.alpha.replyStates.initial)).error).toBeNull();
    expect((await moveTo(adminAlpha, id, fx.alpha.replyStates.visa)).error).toBeNull();

    const visas = await activeVisas(id);
    expect(visas).toHaveLength(1);
    expect(visas[0].superseded_at).not.toBeNull();

    // L'ancien visa ne compte plus : sortir vers l'avant est refusé…
    expect((await moveTo(adminAlpha, id, fx.alpha.replyStates.signature)).error).not.toBeNull();
    // … jusqu'au nouveau visa.
    expect((await visa(viseurAlpha, id)).error).toBeNull();
    expect((await moveTo(adminAlpha, id, fx.alpha.replyStates.signature)).error).toBeNull();
  });

  it.skipIf(!svc)("service_role bypasse le garde de sortie (edge/cron)", async () => {
    const id = await newReplyInVisa(fx.alpha.rootSocleOrgId);
    const { error } = await moveTo(svc!, id, fx.alpha.replyStates.signature);
    expect(error).toBeNull();
  });
});
