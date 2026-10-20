import { ImapFlow } from "imapflow";
import { simpleParser, type ParsedMail } from "mailparser";
import nodemailer from "nodemailer";

// Boîtes mail de test jetables (Ethereal, service gratuit de Nodemailer) : un
// SMTP qui CAPTURE sans jamais livrer, lisible en IMAP. Aucun secret à fournir,
// aucun mail ne sort vers un vrai destinataire.
//
//  - boîte « sortante » : sert de relais SMTP au tenant [TEST] Alpha (écrit
//    dans le miroir `smtp_settings`) — tout mail envoyé par Clara y atterrit ;
//  - boîte « entrante » : boîte IMAP que Clara relève (import IMAP) ;
//  - boîte « scanner » : idem, déclarée « boîte de numérisation ».
// Les tests y déposent leurs messages par SMTP.

export interface TestMailbox {
  user: string;
  pass: string;
  smtp: { host: string; port: number; secure: boolean };
  imap: { host: string; port: number; secure: boolean };
}

export async function createMailbox(): Promise<TestMailbox> {
  const res = await fetch("https://api.nodemailer.com/user", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestor: "clara-e2e", version: "1" }),
  });
  const j = (await res.json()) as {
    status: string;
    user?: string;
    pass?: string;
    smtp?: TestMailbox["smtp"];
    imap?: TestMailbox["imap"];
  };
  if (j.status !== "success" || !j.user || !j.pass || !j.smtp || !j.imap) {
    throw new Error(`Création de la boîte Ethereal impossible : ${JSON.stringify(j)}`);
  }
  return { user: j.user, pass: j.pass, smtp: j.smtp, imap: j.imap };
}

export interface DepositedMail {
  from?: string;
  subject: string;
  text?: string;
  attachments?: { filename: string; content: Buffer; contentType: string }[];
}

/** Dépose un message dans la boîte (Ethereal capture tout mail émis avec ses identifiants). */
export async function depositMail(box: TestMailbox, mail: DepositedMail): Promise<void> {
  const transport = nodemailer.createTransport({
    host: box.smtp.host,
    port: box.smtp.port,
    secure: box.smtp.secure,
    auth: { user: box.user, pass: box.pass },
  });
  await transport.sendMail({
    from: mail.from ?? box.user,
    to: box.user,
    subject: mail.subject,
    text: mail.text ?? "Message déposé par la suite E2E.",
    attachments: mail.attachments,
  });
  transport.close();
}

export interface ReceivedMail {
  parsed: ParsedMail;
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * Attend (sondage) un message de la boîte dont l'objet contient `subjectPart`.
 * Rend `null` si rien n'arrive dans le délai — à l'appelant de décider si c'est
 * un échec (mail attendu) ou le résultat voulu (mail interdit).
 */
export async function waitForMail(
  box: TestMailbox,
  subjectPart: string,
  opts: { timeoutMs?: number; intervalMs?: number; to?: string } = {},
): Promise<ReceivedMail | null> {
  const { timeoutMs = 60_000, intervalMs = 3_000, to } = opts;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = await findMail(box, subjectPart, to);
    if (found) return found;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return null;
}

async function findMail(box: TestMailbox, subjectPart: string, toFilter?: string): Promise<ReceivedMail | null> {
  const client = new ImapFlow({
    host: box.imap.host,
    port: box.imap.port,
    secure: box.imap.secure,
    auth: { user: box.user, pass: box.pass },
    logger: false,
  });
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const uids = await client.search(toFilter ? { to: toFilter } : { subject: subjectPart }, { uid: true });
      if (!uids || uids.length === 0) return null;
      const msg = await client.fetchOne(String(uids[uids.length - 1]), { source: true }, { uid: true });
      if (!msg || !msg.source) return null;
      const parsed = await simpleParser(msg.source);
      const to = Array.isArray(parsed.to) ? parsed.to.map((t) => t.text).join(", ") : (parsed.to?.text ?? "");
      return {
        parsed,
        to,
        subject: parsed.subject ?? "",
        text: parsed.text ?? "",
        html: typeof parsed.html === "string" ? parsed.html : "",
      };
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => undefined);
  }
}

// ─── Garde-fou : jamais de mail vers une vraie personne ──────────────────────
// Toute adresse saisie par un test passe par `testRecipient()`. Seuls les
// domaines réservés aux tests (RFC 2606) et les boîtes Ethereal sont admis.
const SAFE_DOMAINS = ["example.test", "example.com", "example.org", "ethereal.email", "test.clara.local"];

export function assertTestRecipient(address: string): string {
  const domain = address.trim().toLowerCase().split("@")[1] ?? "";
  if (!SAFE_DOMAINS.includes(domain)) {
    throw new Error(`Garde-fou E2E : « ${address} » n'est pas une adresse de test (domaines admis : ${SAFE_DOMAINS.join(", ")}).`);
  }
  return address.trim();
}

/** Adresse de test unique et lisible, que les tests savent reconnaître. */
export function testRecipient(label: string): string {
  return assertTestRecipient(`e2e-${label}-${Date.now().toString(36)}@example.test`);
}
