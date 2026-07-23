import { describe, it, expect, beforeAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clientAs, loadFixtures, serviceRoleClient, type Fixtures } from "./helpers";

// ═══ Garde serveur de la SIGNATURE (trigger couriers_enforce_signature).
// Signer = poser metadata.signed_at/signed_by/signed_state_id sur une réponse
// (ligne couriers outbound). Règle : seul un utilisateur lié comme SIGNATAIRE de
// l'organisation gestionnaire (socle_organization_signatories → signatories.user_id)
// peut poser ou retirer ces marqueurs — même par appel Supabase direct.
// La sélection du signataire (metadata.signatory_id) et l'édition du corps restent
// libres pour tout éditeur. Fixture : signataire.alpha lié à la RACINE Socle
// d'Alpha (pas au Cabinet). Migration : 20260723163536_courier_signature_guard.sql.

let fx: Fixtures;
let adminAlpha: SupabaseClient;
let membreAlpha: SupabaseClient;
let signataireAlpha: SupabaseClient;
const svc = serviceRoleClient();

beforeAll(async () => {
  fx = loadFixtures();
  adminAlpha = await clientAs(fx.users.adminAlpha, fx.password);
  membreAlpha = await clientAs(fx.users.membreAlpha, fx.password);
  signataireAlpha = await clientAs(fx.users.signataireAlpha, fx.password);
});

/** Crée un courrier parent + une réponse (outbound) rattachée à l'org donnée. */
async function newReply(socleOrgId: string): Promise<string> {
  const { data: parent, error: pErr } = await adminAlpha
    .from("couriers")
    .insert({
      organization_id: fx.alpha.orgId,
      direction: "inbound",
      channel: "paper",
      subject: "[TEST] parent signature-guard",
      received_at: new Date().toISOString(),
      socle_organization_id: socleOrgId,
      workflow_state_id: fx.alpha.states.initial,
    })
    .select("id")
    .single();
  if (pErr) throw new Error(`parent: ${pErr.message}`);

  const { data: reply, error: rErr } = await adminAlpha
    .from("couriers")
    .insert({
      organization_id: fx.alpha.orgId,
      direction: "outbound",
      channel: "paper",
      subject: "[TEST] réponse signature-guard",
      sent_at: new Date().toISOString(),
      parent_courier_id: parent!.id,
      socle_organization_id: socleOrgId,
      workflow_state_id: fx.alpha.replyStates.initial,
      metadata: { body_html: "<p>Brouillon</p>" },
    })
    .select("id")
    .single();
  if (rErr) throw new Error(`réponse: ${rErr.message}`);
  return reply!.id as string;
}

/** Pose (ou retire) les marqueurs de signature par UPDATE direct. */
async function setSignature(client: SupabaseClient, replyId: string, signed: boolean) {
  const { data: row } = await client.from("couriers").select("metadata").eq("id", replyId).single();
  const meta = ((row as { metadata: Record<string, unknown> | null } | null)?.metadata) ?? {};
  const nextMeta = signed
    ? { ...meta, signed_at: new Date().toISOString(), signed_by: "[TEST] Signataire", signed_state_id: fx.alpha.replyStates.signature }
    : { ...meta, signed_at: null, signed_by: null, signed_state_id: null };
  return client.from("couriers").update({ metadata: nextMeta }).eq("id", replyId).select("id");
}

describe("Garde de signature — refus serveur", () => {
  it("un éditeur NON signataire ne peut pas signer (appel direct)", async () => {
    const id = await newReply(fx.alpha.rootSocleOrgId);
    const { error } = await setSignature(membreAlpha, id, true);
    expect(error).not.toBeNull();
  });

  it("un admin NON signataire ne peut pas signer non plus", async () => {
    const id = await newReply(fx.alpha.rootSocleOrgId);
    const { error } = await setSignature(adminAlpha, id, true);
    expect(error).not.toBeNull();
  });

  it("le signataire de la RACINE ne peut pas signer une réponse du Cabinet (par organisation)", async () => {
    const id = await newReply(fx.alpha.subSocleOrgId);
    const { error } = await setSignature(signataireAlpha, id, true);
    expect(error).not.toBeNull();
  });

  it("dé-signer est soumis à la même règle", async () => {
    const id = await newReply(fx.alpha.rootSocleOrgId);
    const ok = await setSignature(signataireAlpha, id, true);
    expect(ok.error).toBeNull();
    const { error } = await setSignature(membreAlpha, id, false);
    expect(error).not.toBeNull();
  });

  it("un INSERT pré-signé forgé est refusé", async () => {
    const { error } = await membreAlpha.from("couriers").insert({
      organization_id: fx.alpha.orgId,
      direction: "outbound",
      channel: "paper",
      subject: "[TEST] réponse pré-signée pirate",
      sent_at: new Date().toISOString(),
      socle_organization_id: fx.alpha.rootSocleOrgId,
      workflow_state_id: fx.alpha.replyStates.initial,
      metadata: { signed_at: new Date().toISOString(), signed_by: "pirate" },
    });
    expect(error).not.toBeNull();
  });
});

describe("Garde de signature — flux légitimes", () => {
  it("le signataire lié à l'organisation signe puis dé-signe", async () => {
    const id = await newReply(fx.alpha.rootSocleOrgId);
    const sign = await setSignature(signataireAlpha, id, true);
    expect(sign.error).toBeNull();
    const unsign = await setSignature(signataireAlpha, id, false);
    expect(unsign.error).toBeNull();
  });

  it("préparer le brouillon reste libre : corps + sélection du signataire sans marqueurs", async () => {
    const id = await newReply(fx.alpha.rootSocleOrgId);
    const { data: row } = await membreAlpha.from("couriers").select("metadata").eq("id", id).single();
    const meta = ((row as { metadata: Record<string, unknown> | null } | null)?.metadata) ?? {};
    const { error } = await membreAlpha
      .from("couriers")
      .update({ metadata: { ...meta, body_html: "<p>Nouveau corps</p>", signatory_id: fx.alpha.signatoryId } })
      .eq("id", id);
    expect(error).toBeNull();
  });

  it.skipIf(!svc)("service_role bypasse le garde (edge/cron)", async () => {
    const id = await newReply(fx.alpha.rootSocleOrgId);
    const { error } = await setSignature(svc!, id, true);
    expect(error).toBeNull();
  });
});
