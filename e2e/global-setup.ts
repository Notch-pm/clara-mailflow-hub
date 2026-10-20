import { adminClient, hasServiceRole, MAILBOXES_ENV, type MailBoxes } from "./support/admin";
import { createMailbox } from "./support/mailbox";
import { loadFixtures } from "./helpers";

// Prépare, une fois par run, l'infrastructure mail des E2E :
//  - 3 boîtes Ethereal jetables (relais sortant, boîte IMAP, boîte scanner) ;
//  - le miroir SMTP de [TEST] Alpha pointé sur la boîte sortante (RPC de service
//    `sync_smtp_settings_from_socle`, la même que la synchronisation du Socle).
// Sans service_role ou sans réseau, rien n'est posé : les specs concernées se
// sautent (voir `requireMail` dans e2e/support/fixtures.ts).
export default async function globalSetup() {
  if (!hasServiceRole) {
    console.warn("[e2e] SUPABASE_SERVICE_ROLE_KEY absent — specs mail / IMAP / seed sautées.");
    return;
  }
  try {
    const fx = loadFixtures();
    const [outgoing, incoming, scanner] = await Promise.all([createMailbox(), createMailbox(), createMailbox()]);
    const { error } = await adminClient().rpc("sync_smtp_settings_from_socle", {
      p_org_id: fx.alpha.orgId,
      p_socle_org_id: crypto.randomUUID(),
      p_host: outgoing.smtp.host,
      p_port: outgoing.smtp.port,
      p_username: outgoing.user,
      p_password: outgoing.pass,
      p_from_email: outgoing.user,
      p_from_name: "[TEST] Mairie Alpha",
      p_use_tls: true,
      p_socle_updated_at: null,
    });
    if (error) throw new Error(`miroir SMTP: ${error.message}`);
    const boxes: MailBoxes = { outgoing, incoming, scanner };
    process.env[MAILBOXES_ENV] = JSON.stringify(boxes);
    console.log(`[e2e] Relais SMTP de test posé sur ${fx.alpha.name}.`);
  } catch (e) {
    console.warn(`[e2e] Infrastructure mail indisponible : ${(e as Error).message}`);
  }
}
