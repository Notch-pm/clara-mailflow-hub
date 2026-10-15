// Identifiants de messagerie (SMTP, IMAP) : les mots de passe vivent dans
// Supabase Vault, jamais en clair dans une table (migration
// 20261015070257_identifiants_mail_vault). Seul le service les relit, par deux
// RPC réservées à `service_role` — le client passé ici DOIT être un client
// service_role.
//
// Le mot de passe ne fait que traverser ce module vers nodemailer / IMAP : il
// n'apparaît dans aucun journal ni message d'erreur.

// Client service_role, typé au minimum : les fonctions n'importent pas toutes
// la même version de supabase-js, et leurs types ne sont pas compatibles entre eux.
// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- cf. ci-dessus
type ServiceClient = { from: (table: string) => any; rpc: (fn: string, args: Record<string, unknown>) => any };

/** Miroir du serveur d'envoi (`smtp_settings`), mot de passe déchiffré en plus. */
export interface SmtpSettings {
  organization_id: string;
  host: string;
  port: number | null;
  username: string;
  password: string;
  from_email: string;
  from_name: string;
  use_tls: boolean;
  [column: string]: unknown;
}

/**
 * Miroir du serveur d'envoi d'un tenant, mot de passe déchiffré compris.
 * Même forme que `.maybeSingle()` : `{ data: null, error: null }` quand le
 * tenant n'a pas de relais.
 */
export async function loadSmtpSettings(
  admin: ServiceClient,
  organizationId: string,
): Promise<{ data: SmtpSettings | null; error: unknown }> {
  const { data, error } = await admin
    .from("smtp_settings")
    .select("*")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error || !data) return { data: null, error };
  const { data: password, error: pwError } = await admin.rpc("get_smtp_password", { p_org_id: organizationId });
  if (pwError) return { data: null, error: pwError };
  return { data: { ...data, password: typeof password === "string" ? password : "" }, error: null };
}

/** Mot de passe déchiffré d'une boîte IMAP (chaîne vide s'il n'y en a pas). */
export async function loadImapPassword(admin: ServiceClient, imapSettingsId: string): Promise<string> {
  const { data, error } = await admin.rpc("get_imap_password", { p_imap_settings_id: imapSettingsId });
  if (error) throw new Error("Mot de passe de la boîte de réception illisible.");
  return typeof data === "string" ? data : "";
}
