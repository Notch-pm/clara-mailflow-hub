import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clientAs, loadFixtures, serviceRoleClient, type Fixtures } from "./helpers";

// ═══ Mots de passe IMAP dans Vault (migrations 20261015070257 / 20261015070716) :
// l'administrateur REMPLACE le mot de passe d'une boîte, ne le relit jamais ;
// seul le service le déchiffre ; un membre ne peut ni l'un ni l'autre.

let fx: Fixtures;
let adminAlpha: SupabaseClient;
let membreAlpha: SupabaseClient;
let boxId: string;

beforeAll(async () => {
  fx = loadFixtures();
  adminAlpha = await clientAs(fx.users.adminAlpha, fx.password);
  membreAlpha = await clientAs(fx.users.membreAlpha, fx.password);
  const { data, error } = await adminAlpha
    .from("imap_settings")
    .insert({ organization_id: fx.alpha.orgId, label: "[TEST] boîte Vault", host: "imap.test.invalid", username: "u" })
    .select("id")
    .single();
  if (error) throw error;
  boxId = data.id;
});

afterAll(async () => {
  if (boxId) await adminAlpha.from("imap_settings").delete().eq("id", boxId);
});

describe("Mot de passe IMAP : écriture seule pour l'administrateur", () => {
  it("l'administrateur enregistre un mot de passe", async () => {
    const { error } = await adminAlpha.rpc("set_imap_password", { p_imap_settings_id: boxId, p_password: "s3cret à espace " });
    expect(error).toBeNull();
    const { data } = await adminAlpha.from("imap_settings").select("password_secret_id").eq("id", boxId).single();
    expect(data?.password_secret_id).toBeTruthy();
  });

  it("aucune colonne de mot de passe en clair n'est lisible", async () => {
    const { error } = await adminAlpha.from("imap_settings").select("password").eq("id", boxId);
    expect(error).not.toBeNull();
  });

  it("l'administrateur ne peut pas déchiffrer", async () => {
    const { error } = await adminAlpha.rpc("get_imap_password", { p_imap_settings_id: boxId });
    expect(error).not.toBeNull();
  });

  it("un membre ne peut pas remplacer le mot de passe", async () => {
    const { error } = await membreAlpha.rpc("set_imap_password", { p_imap_settings_id: boxId, p_password: "pirate" });
    expect(error).not.toBeNull();
  });

  it("le service relit le mot de passe tel quel (espaces compris)", async () => {
    const service = serviceRoleClient();
    if (!service) return;
    const { data, error } = await service.rpc("get_imap_password", { p_imap_settings_id: boxId });
    expect(error).toBeNull();
    expect(data).toBe("s3cret à espace ");
  });
});
