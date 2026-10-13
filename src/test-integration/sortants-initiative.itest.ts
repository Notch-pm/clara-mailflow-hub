import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clientAs, loadFixtures, type Fixtures } from "./helpers";

// ═══ Courriers sortants à l'initiative de la collectivité : ce que la RLS et la
// garde `couriers_enforce_outbound_initiative` laissent passer, appel direct
// compris (CA3, CA5, CA25). Le refus d'une organisation sans workflow
// de réponse est éprouvé par `supabase/tests/outbound_initiative.test.sql` :
// toutes les organisations du seed en ont un. Le décor : [TEST] Alpha, dont l'organisation racine
// a un workflow de réponse (seed). Les sortants créés sont supprimés à la fin.

let fx: Fixtures;
let membreAlpha: SupabaseClient;
let consultantAlpha: SupabaseClient;
let membreBeta: SupabaseClient;
const created: string[] = [];

const RECIPIENT = {
  socle_contact_id: "00000000-0000-4000-8000-0000000000aa",
  name: "[TEST] Destinataire",
  email: "destinataire@test.clara.local",
};

beforeAll(async () => {
  fx = loadFixtures();
  membreAlpha = await clientAs(fx.users.membreAlpha, fx.password);
  consultantAlpha = await clientAs(fx.users.consultantAlpha, fx.password);
  membreBeta = await clientAs(fx.users.membreBeta, fx.password);
});

afterAll(async () => {
  if (created.length) await membreAlpha.from("couriers").delete().in("id", created);
});

describe("Création d'un sortant à l'initiative", () => {
  it("un gestionnaire crée le courrier à l'état initial du workflow de réponse", async () => {
    const { data: id, error } = await membreAlpha.rpc("create_outbound_courier", {
      p_organization_id: fx.alpha.orgId,
      p_socle_organization_id: fx.alpha.rootSocleOrgId,
      p_channel: "email",
      p_subject: "[TEST] Convocation",
      p_recipient: RECIPIENT,
    });
    expect(error).toBeNull();
    created.push(id as string);

    const { data: row } = await membreAlpha
      .from("couriers")
      .select("direction, parent_courier_id, workflow_state_id, chrono, sent_at, courier_participants(role, socle_contact_id)")
      .eq("id", id as string)
      .single();
    expect(row?.direction).toBe("outbound");
    expect(row?.parent_courier_id).toBeNull();
    expect(row?.workflow_state_id).toBe(fx.alpha.replyStates.initial);
    expect(row?.chrono).toMatch(/-S-/);
    expect(row?.sent_at).toBeNull();
    expect(row?.courier_participants).toEqual([
      { role: "recipient", socle_contact_id: RECIPIENT.socle_contact_id },
    ]);
  });

  it("un consultant est refusé (CA5)", async () => {
    const { error } = await consultantAlpha.rpc("create_outbound_courier", {
      p_organization_id: fx.alpha.orgId,
      p_socle_organization_id: fx.alpha.rootSocleOrgId,
      p_channel: "paper",
      p_subject: "[TEST] Consultant",
      p_recipient: RECIPIENT,
    });
    expect(error).not.toBeNull();
  });

  it("une organisation d'un autre tenant est refusée (CA25)", async () => {
    const { error } = await membreBeta.rpc("create_outbound_courier", {
      p_organization_id: fx.beta.orgId,
      p_socle_organization_id: fx.alpha.rootSocleOrgId,
      p_channel: "paper",
      p_subject: "[TEST] Autre tenant",
      p_recipient: RECIPIENT,
    });
    expect(error).not.toBeNull();
  });

  it("un INSERT direct sans organisation ni workflow est refusé (CA3)", async () => {
    const { error } = await membreAlpha.from("couriers").insert({
      organization_id: fx.alpha.orgId,
      direction: "outbound",
      channel: "paper",
      subject: "[TEST] Coquille",
    });
    expect(error?.message).toMatch(/organisation qui émet/);
  });
});
