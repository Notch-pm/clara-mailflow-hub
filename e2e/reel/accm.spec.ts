import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import type { Session } from "@supabase/supabase-js";
import { loginWithSession, magicLinkSession, RUN_ID, sessionClient, toastLocator } from "../helpers";
import { test, expect } from "../support/fixtures";
import { adminClient } from "../support/admin";
import { assertRealTestRecipient } from "../support/mailbox";

// ═══ Courriels RÉELS sur ACCM (tenant de démo) — à la demande seulement :
//   E2E_REEL=1 bun run test:e2e -- e2e/reel
// Le reste de la suite capte tout par Ethereal ; ici les mails partent vraiment :
//  - envoi : un sortant ACCM part par le SMTP réel (Mailjet) vers un usager de
//    test du Socle d'ACCM — la RÉCEPTION se constate dans la boîte Gmail de
//    Laurent (plus-addressing `jacquotlaurent+e2e-…`), que la suite ne lit pas ;
//  - réception : un courriel `[E2E-…]` envoyé à contact@notch.pm devient un
//    courrier ACCM par la relève AUTOMATIQUE (cron toutes les 5 min).
// Exception assumée à « jamais d'écriture hors [TEST] » : ACCM est une démo ;
// tout ce que crée la spec porte `[E2E-<run>]` et est supprimé en fin de run.
// Ne JAMAIS viser un contact de démo existant (adresses peut-être réelles).

const ACCM = "55dab847-7a67-4fa2-b878-70c25338fc9e";
const ACCM_INBOX = "contact@notch.pm";
/** Compte agent persistant d'ACCM (administrateur), connecté par lien magique. */
const AGENT = process.env.E2E_ACCM_AGENT ?? "jacquotlaurent+e2e-agent@gmail.com";
/** Organisation émettrice : son circuit a un état d'envoi « Prêt à envoyer ». */
const DIRECTION_CABINET = "c0e13ed3-26d9-4434-b56f-ec639aea334a";
/** Usager de test créé au Socle d'ACCM (gardé, cf. mémoire projet). */
const USAGER_SORTANT = {
  socle_contact_id: "0041f4b3-af35-4208-9374-2b6bbc488c78",
  name: "Usager E2E Sortant",
  email: assertRealTestRecipient("jacquotlaurent+e2e-sortant@gmail.com"),
};
const TAG = `[E2E-${RUN_ID}]`;

test.describe.configure({ mode: "serial" });
test.skip(process.env.E2E_REEL !== "1", "Courriels réels : lancer avec E2E_REEL=1");

let agent: Session;

test.beforeAll(async () => {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  agent = await magicLinkSession(AGENT);
});

test.afterAll(async () => {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  // D'abord le message dans la boîte : la relève cherche `SINCE <jour>` et ne
  // dédoublonne que par Message-ID parmi les courriers EXISTANTS — un courrier
  // supprimé dont le mail reste en INBOX est réimporté au passage suivant.
  await deleteFromAccmInbox(TAG);
  // Suppression en cascade (événements, participants, analyses…) ; aucune pièce Storage créée ici.
  await adminClient().from("couriers").delete().eq("organization_id", ACCM).like("subject", `%${TAG}%`);
});

async function deleteFromAccmInbox(subjectPart: string): Promise<void> {
  const admin = adminClient();
  const { data: box } = await admin.from("imap_settings").select("id, host, port, username, use_tls, folder")
    .eq("organization_id", ACCM).eq("username", ACCM_INBOX).single();
  const b = box as { id: string; host: string; port: number; username: string; use_tls: boolean; folder: string | null };
  const { data: pass } = await admin.rpc("get_imap_password", { p_imap_settings_id: b.id });
  const client = new ImapFlow({ host: b.host, port: b.port, secure: b.use_tls, auth: { user: b.username, pass: pass as string }, logger: false });
  await client.connect();
  const lock = await client.getMailboxLock(b.folder ?? "INBOX");
  try {
    const uids = await client.search({ subject: subjectPart }, { uid: true });
    if (uids && uids.length) await client.messageDelete(uids, { uid: true });
  } finally {
    lock.release();
    await client.logout();
  }
}

test("envoi réel : un sortant part par le SMTP d'ACCM vers l'usager de test", async ({ page, needAdmin }) => {
  needAdmin();
  test.setTimeout(120_000);
  const MARK = `Mention E2E réelle ${RUN_ID}`;

  const { data: id, error } = await sessionClient(agent).rpc("create_outbound_courier", {
    p_organization_id: ACCM,
    p_socle_organization_id: DIRECTION_CABINET,
    p_channel: "email",
    p_subject: `${TAG} Sortant réel — à ignorer`,
    p_recipient: USAGER_SORTANT,
  });
  expect(error).toBeNull();
  const outboundId = id as string;

  // Décor : rédigé et prêt à envoyer (le circuit visa/signature est couvert par
  // e2e/sortants avec Ethereal ; ici seul l'envoi réel compte).
  const { data: org } = await adminClient()
    .from("socle_organizations").select("reply_workflow_id").eq("id", DIRECTION_CABINET).single();
  const { data: sendState } = await adminClient()
    .from("workflow_states").select("id")
    .eq("workflow_id", (org as { reply_workflow_id: string }).reply_workflow_id).eq("is_send", true).single();
  const html = `<p>Bonjour,</p><p>Courriel de test de la suite E2E de Clara, à ignorer.</p><p>${MARK}</p>`;
  const { error: upErr } = await adminClient().from("couriers")
    .update({
      workflow_state_id: (sendState as { id: string }).id,
      metadata: { body_html: html, body_text: "", is_draft: false },
    })
    .eq("id", outboundId);
  expect(upErr).toBeNull();

  await loginWithSession(page, agent, ACCM);
  await page.goto(`/courrier/${outboundId}`);
  await page.getByRole("tab", { name: "Rédaction" }).click();
  // Le bouton porte le nom de l'état cible du workflow (« Envoyé » sur ACCM, « Envoyer… » sur [TEST]).
  await page.getByRole("button", { name: /^Envoy/ }).click();
  await expect(toastLocator(page, /Courriel envoyé à/)).toBeVisible({ timeout: 60_000 });

  const { data: sent } = await adminClient().from("couriers").select("metadata").eq("id", outboundId).single();
  expect((sent as { metadata: Record<string, unknown> }).metadata.sent_email_at).toBeTruthy();
  const { data: events } = await adminClient()
    .from("courier_events").select("event_type, payload").eq("courier_id", outboundId).eq("event_type", "reply_email_sent");
  expect(events?.[0]?.payload).toMatchObject({ to: USAGER_SORTANT.email });
  console.log(`[e2e réel] Vérifier dans Gmail : « ${TAG} Sortant réel » reçu sur ${USAGER_SORTANT.email} (contient « ${MARK} »).`);
});

test("réception réelle : un courriel à contact@notch.pm devient un courrier ACCM (relève automatique)", async ({ needAdmin }) => {
  needAdmin();
  test.setTimeout(9 * 60_000);
  const subject = `${TAG} Réception réelle — à ignorer`;

  // Envoyé par le SMTP d'ACCM lui-même : c'est la seule boîte d'émission réelle dont dispose la suite.
  const admin = adminClient();
  const { data: smtp } = await admin.from("smtp_settings").select("host, port, username, from_email").eq("organization_id", ACCM).single();
  const { data: pass } = await admin.rpc("get_smtp_password", { p_org_id: ACCM });
  const s = smtp as { host: string; port: number; username: string; from_email: string };
  const transport = nodemailer.createTransport({ host: s.host, port: s.port, secure: false, auth: { user: s.username, pass: pass as string } });
  await transport.sendMail({
    from: s.from_email,
    to: assertRealTestRecipient(ACCM_INBOX),
    subject,
    text: "Courriel de test de la suite E2E de Clara, à ignorer.",
  });
  transport.close();

  // Le cron passe toutes les 5 minutes : on attend jusqu'à deux passages.
  await expect(async () => {
    const { data } = await admin.from("couriers").select("channel, direction").eq("organization_id", ACCM).eq("subject", subject).maybeSingle();
    expect(data, "pas encore relevé").toMatchObject({ channel: "email", direction: "inbound" });
  }).toPass({ timeout: 8 * 60_000, intervals: [15_000] });
});
