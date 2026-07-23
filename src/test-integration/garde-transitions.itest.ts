import { describe, it, expect, beforeAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clientAs, loadFixtures, serviceRoleClient, type Fixtures } from "./helpers";

// ═══ Garde serveur des transitions de workflow (trigger couriers_enforce_transition).
// (a) SERVEUR : un éditeur qui tente un saut illégal par appel direct est REFUSÉ.
// (b) FLUX LÉGITIMES : création, transitions configurées, clôture, réassignation
//     avec reset, cycle de réponse, courrier non assigné — doivent CONTINUER à marcher.
// (c) BYPASS : un client service_role fait n'importe quoi (edge/cron).
// Spec : docs/garde-transitions-workflow.md.

let fx: Fixtures;
let adminAlpha: SupabaseClient;
const svc = serviceRoleClient();

beforeAll(async () => {
  fx = loadFixtures();
  adminAlpha = await clientAs(fx.users.adminAlpha, fx.password);
});

/** Crée un courrier entrant jetable dans Alpha (en tant qu'éditeur). */
async function newCourier(socleOrgId: string | null, stateId: string | null): Promise<string> {
  const { data, error } = await adminAlpha
    .from("couriers")
    .insert({
      organization_id: fx.alpha.orgId,
      direction: "inbound",
      channel: "paper",
      subject: "[TEST] garde-transitions",
      received_at: new Date().toISOString(),
      socle_organization_id: socleOrgId,
      workflow_state_id: stateId,
    })
    .select("id")
    .single();
  if (error) throw new Error(`création courrier échouée: ${error.message}`);
  return data!.id as string;
}

describe("Garde de transitions — refus serveur (appel direct)", () => {
  it("AC-S1 : état d'un autre workflow (réponse) refusé", async () => {
    const id = await newCourier(fx.alpha.rootSocleOrgId, fx.alpha.states.initial);
    const { error } = await adminAlpha
      .from("couriers")
      .update({ workflow_state_id: fx.alpha.replyStates.signature })
      .eq("id", id);
    expect(error).not.toBeNull();
  });

  it("AC-S2 : état d'un autre tenant refusé", async () => {
    const id = await newCourier(fx.alpha.rootSocleOrgId, fx.alpha.states.initial);
    const { error } = await adminAlpha
      .from("couriers")
      .update({ workflow_state_id: fx.beta.states.processing })
      .eq("id", id);
    expect(error).not.toBeNull();
  });

  it("AC-S3 : saut vers un intermédiaire sans transition refusé", async () => {
    const id = await newCourier(fx.alpha.rootSocleOrgId, fx.alpha.states.initial);
    const { error } = await adminAlpha
      .from("couriers")
      .update({ workflow_state_id: fx.alpha.midNoTransitionStateId })
      .eq("id", id);
    expect(error).not.toBeNull();
  });

  it("AC-S4 : réassignation atterrissant au milieu d'un autre workflow refusée", async () => {
    const id = await newCourier(fx.alpha.rootSocleOrgId, fx.alpha.states.initial);
    const { error } = await adminAlpha
      .from("couriers")
      .update({ socle_organization_id: fx.alpha.socleOrgBId, workflow_state_id: fx.alpha.statesB.mid })
      .eq("id", id);
    expect(error).not.toBeNull();
  });

  it("AC-S5 : état inexistant refusé (FK)", async () => {
    const id = await newCourier(fx.alpha.rootSocleOrgId, fx.alpha.states.initial);
    const { error } = await adminAlpha
      .from("couriers")
      .update({ workflow_state_id: crypto.randomUUID() })
      .eq("id", id);
    expect(error).not.toBeNull();
  });
});

describe("Garde de transitions — flux légitimes autorisés", () => {
  it("AC-L1 : création à l'état initial", async () => {
    const { data, error } = await adminAlpha
      .from("couriers")
      .insert({
        organization_id: fx.alpha.orgId,
        direction: "inbound",
        channel: "paper",
        subject: "[TEST] garde AC-L1",
        received_at: new Date().toISOString(),
        socle_organization_id: fx.alpha.rootSocleOrgId,
        workflow_state_id: fx.alpha.states.initial,
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    expect(data?.id).toBeTruthy();
  });

  it("AC-L2 : transitions configurées initial→processing→final", async () => {
    const id = await newCourier(fx.alpha.rootSocleOrgId, fx.alpha.states.initial);
    const r1 = await adminAlpha.from("couriers").update({ workflow_state_id: fx.alpha.states.processing }).eq("id", id);
    expect(r1.error).toBeNull();
    const r2 = await adminAlpha.from("couriers").update({ workflow_state_id: fx.alpha.states.final }).eq("id", id);
    expect(r2.error).toBeNull();
  });

  it("AC-L3 : clôture directe initial→final", async () => {
    const id = await newCourier(fx.alpha.rootSocleOrgId, fx.alpha.states.initial);
    const { error } = await adminAlpha.from("couriers").update({ workflow_state_id: fx.alpha.states.final }).eq("id", id);
    expect(error).toBeNull();
  });

  it("AC-L4 : réassignation d'org avec reset à l'initial (même workflow)", async () => {
    const id = await newCourier(fx.alpha.rootSocleOrgId, fx.alpha.states.initial);
    // amener à un état non-initial d'abord
    await adminAlpha.from("couriers").update({ workflow_state_id: fx.alpha.states.processing }).eq("id", id);
    const { error } = await adminAlpha
      .from("couriers")
      .update({ socle_organization_id: fx.alpha.subSocleOrgId, workflow_state_id: fx.alpha.states.initial })
      .eq("id", id);
    expect(error).toBeNull();
  });

  it("AC-L5 : retrait de l'état (→ NULL)", async () => {
    const id = await newCourier(fx.alpha.rootSocleOrgId, fx.alpha.states.initial);
    const { error } = await adminAlpha.from("couriers").update({ workflow_state_id: null }).eq("id", id);
    expect(error).toBeNull();
  });

  it("AC-L6 : cycle d'une réponse initial→signature→final", async () => {
    const parent = await newCourier(fx.alpha.rootSocleOrgId, fx.alpha.states.initial);
    const { data: reply, error: cErr } = await adminAlpha
      .from("couriers")
      .insert({
        organization_id: fx.alpha.orgId,
        direction: "outbound",
        channel: "email",
        subject: "[TEST] garde réponse",
        sent_at: new Date().toISOString(),
        parent_courier_id: parent,
        socle_organization_id: fx.alpha.rootSocleOrgId,
        workflow_state_id: fx.alpha.replyStates.initial,
      })
      .select("id")
      .single();
    expect(cErr).toBeNull();
    const rid = reply!.id as string;
    const r1 = await adminAlpha.from("couriers").update({ workflow_state_id: fx.alpha.replyStates.signature }).eq("id", rid);
    expect(r1.error).toBeNull();
    const r2 = await adminAlpha.from("couriers").update({ workflow_state_id: fx.alpha.replyStates.final }).eq("id", rid);
    expect(r2.error).toBeNull();
  });

  it("AC-L7 : transition sur un courrier non assigné (W* déduit de l'état)", async () => {
    const id = await newCourier(null, fx.alpha.states.initial);
    const { error } = await adminAlpha.from("couriers").update({ workflow_state_id: fx.alpha.states.processing }).eq("id", id);
    expect(error).toBeNull();
  });
});

describe("Garde de transitions — bypass service_role", () => {
  it.skipIf(!svc)("AC-L8 : service_role bypasse le garde (saut illégal autorisé)", async () => {
    const id = await newCourier(fx.alpha.rootSocleOrgId, fx.alpha.states.initial);
    // initial → intermédiaire sans transition : refusé pour un éditeur, autorisé en service_role
    const { error } = await svc!.from("couriers").update({ workflow_state_id: fx.alpha.midNoTransitionStateId }).eq("id", id);
    expect(error).toBeNull();
  });
});
