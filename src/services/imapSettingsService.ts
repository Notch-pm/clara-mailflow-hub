import { supabase } from "@/integrations/supabase/client";
import type { Tables, TablesInsert } from "@/integrations/supabase/types";

/**
 * Boîtes de réception IMAP d'une organisation. Le mot de passe est un secret
 * Vault (migration 20261015090000) : l'écran peut le REMPLACER, jamais le relire.
 */
export type ImapSettingsRow = Omit<Tables<"imap_settings">, "password">;

/** Champs saisis à l'écran, mot de passe exclu (il suit son propre chemin). */
export type ImapSettingsFields = Omit<
  TablesInsert<"imap_settings">,
  "id" | "organization_id" | "password" | "password_secret_id" | "created_at" | "updated_at"
>;

const COLUMNS =
  "id, organization_id, label, host, port, username, use_tls, folder, auto_fetch, last_fetch_at, last_error, " +
  "created_at, updated_at, socle_organization_id, is_scan_inbox, scan_allowed_senders, max_email_bytes, password_secret_id";

export async function listImapSettings(organizationId: string): Promise<ImapSettingsRow[]> {
  const { data, error } = await supabase
    .from("imap_settings")
    .select(COLUMNS)
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as ImapSettingsRow[];
}

/**
 * Crée ou met à jour une boîte. `password` vide = mot de passe inchangé
 * (en création : aucun mot de passe enregistré).
 */
export async function saveImapSettings(
  organizationId: string,
  id: string | null,
  fields: ImapSettingsFields,
  password: string,
): Promise<void> {
  let rowId = id;
  if (rowId) {
    const { error } = await supabase
      .from("imap_settings")
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq("organization_id", organizationId)
      .eq("id", rowId);
    if (error) throw error;
  } else {
    const { data, error } = await supabase
      .from("imap_settings")
      .insert({ ...fields, organization_id: organizationId })
      .select("id")
      .single();
    if (error) throw error;
    rowId = data.id;
  }
  if (password !== "") {
    const { error } = await supabase.rpc("set_imap_password", { p_imap_settings_id: rowId, p_password: password });
    if (error) throw error;
  }
}

export async function deleteImapSettings(organizationId: string, id: string): Promise<void> {
  const { error } = await supabase.from("imap_settings").delete().eq("organization_id", organizationId).eq("id", id);
  if (error) throw error;
}
