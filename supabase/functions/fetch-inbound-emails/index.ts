// Edge function: fetch-inbound-emails
// Récupère les emails non lus via IMAP pour chaque organisation et les transforme en couriers.
// Modes:
//  - POST avec body { organization_id, test? } => fetch ciblé (auth user, droit admin requis)
//  - POST avec header x-cron-secret             => fetch global (cron toutes les 5 min)
//
// Implémentation IMAP minimale via Deno.connectTls (compatible edge runtime).

import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { simpleParser } from "npm:mailparser@3.7.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret, x-org-id",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

interface ImapSettings {
  id: string;
  organization_id: string;
  host: string;
  port: number;
  username: string;
  password: string;
  use_tls: boolean;
  folder: string;
  auto_fetch: boolean;
}

// ===================== Mini client IMAP =====================

class ImapClient {
  private conn: Deno.TlsConn | Deno.Conn | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private buffer = new Uint8Array(0);
  private tag = 0;
  private decoder = new TextDecoder("utf-8");
  private encoder = new TextEncoder();

  constructor(private host: string, private port: number, private secure: boolean) {}

  async connect(): Promise<void> {
    if (this.secure) {
      this.conn = await Deno.connectTls({ hostname: this.host, port: this.port });
    } else {
      this.conn = await Deno.connect({ hostname: this.host, port: this.port });
    }
    this.reader = this.conn.readable.getReader();
    this.writer = this.conn.writable.getWriter();
    // greeting
    await this.readLine();
  }

  async close(): Promise<void> {
    try { await this.writer?.close(); } catch (_) {}
    try { this.reader?.releaseLock(); } catch (_) {}
    try { this.conn?.close(); } catch (_) {}
  }

  private async readChunk(): Promise<boolean> {
    if (!this.reader) return false;
    const { value, done } = await this.reader.read();
    if (done || !value) return false;
    const merged = new Uint8Array(this.buffer.length + value.length);
    merged.set(this.buffer, 0);
    merged.set(value, this.buffer.length);
    this.buffer = merged;
    return true;
  }

  private async readLine(): Promise<string> {
    while (true) {
      const idx = this.buffer.indexOf(0x0a); // \n
      if (idx >= 0) {
        const lineBytes = this.buffer.slice(0, idx);
        this.buffer = this.buffer.slice(idx + 1);
        let line = this.decoder.decode(lineBytes);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        return line;
      }
      const more = await this.readChunk();
      if (!more) throw new Error("IMAP: connexion fermée prématurément");
    }
  }

  private async readBytes(n: number): Promise<Uint8Array> {
    while (this.buffer.length < n) {
      const more = await this.readChunk();
      if (!more) throw new Error("IMAP: connexion fermée pendant lecture littéral");
    }
    const out = this.buffer.slice(0, n);
    this.buffer = this.buffer.slice(n);
    return out;
  }

  private async write(s: string): Promise<void> {
    if (!this.writer) throw new Error("IMAP: pas de writer");
    await this.writer.write(this.encoder.encode(s));
  }

  /** Envoie une commande, lit jusqu'à la ligne taggée. Retourne les lignes (untagged + littéraux concaténés). */
  async command(cmd: string): Promise<{ ok: boolean; lines: string[]; literals: Uint8Array[]; raw: string }> {
    this.tag++;
    const tag = `A${this.tag.toString().padStart(4, "0")}`;
    await this.write(`${tag} ${cmd}\r\n`);
    const lines: string[] = [];
    const literals: Uint8Array[] = [];
    let raw = "";
    while (true) {
      const line = await this.readLine();
      raw += line + "\n";
      // littéral {n}
      const litMatch = line.match(/\{(\d+)\}\s*$/);
      if (litMatch) {
        const n = parseInt(litMatch[1], 10);
        const bytes = await this.readBytes(n);
        literals.push(bytes);
        lines.push(line);
        continue;
      }
      if (line.startsWith(tag + " ")) {
        const status = line.substring(tag.length + 1).split(" ")[0];
        return { ok: status === "OK", lines, literals, raw: raw + "" };
      }
      lines.push(line);
    }
  }

  async login(user: string, pass: string): Promise<void> {
    const escUser = user.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const escPass = pass.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const r = await this.command(`LOGIN "${escUser}" "${escPass}"`);
    if (!r.ok) throw new Error(`LOGIN refusé: ${r.lines[r.lines.length - 1] || "?"}`);
  }

  async selectFolder(name: string): Promise<void> {
    const r = await this.command(`SELECT "${name.replace(/"/g, '\\"')}"`);
    if (!r.ok) throw new Error(`SELECT ${name} refusé`);
  }

  async search(criteria: string): Promise<number[]> {
    const r = await this.command(`UID SEARCH ${criteria}`);
    if (!r.ok) throw new Error(`UID SEARCH refusé`);
    const line = r.lines.find((l) => l.startsWith("* SEARCH"));
    if (!line) return [];
    const parts = line.replace("* SEARCH", "").trim().split(/\s+/).filter(Boolean);
    return parts.map((p) => parseInt(p, 10)).filter((n) => !isNaN(n));
  }

  /**
   * Récupère uniquement les en-têtes (RFC822.HEADER) pour pouvoir lire le
   * Message-ID sans télécharger tout le corps. Économise la bande passante.
   */
  async fetchHeaders(uid: number): Promise<string | null> {
    const r = await this.command(`UID FETCH ${uid} BODY.PEEK[HEADER.FIELDS (MESSAGE-ID)]`);
    if (!r.ok || !r.literals[0]) return null;
    return new TextDecoder("latin1").decode(r.literals[0]);
  }

  async fetchMessage(uid: number): Promise<Uint8Array | null> {
    const r = await this.command(`UID FETCH ${uid} BODY.PEEK[]`);
    if (!r.ok) return null;
    return r.literals[0] || null;
  }

  async markSeen(uid: number): Promise<void> {
    await this.command(`UID STORE ${uid} +FLAGS (\\Seen)`);
  }

  async logout(): Promise<void> {
    try { await this.command("LOGOUT"); } catch (_) {}
    await this.close();
  }
}

// ===================== Traitement organisation =====================

async function processOrganization(
  admin: ReturnType<typeof createClient>,
  s: ImapSettings,
  opts: { onlyTest?: boolean } = {},
): Promise<{ ok: boolean; processed: number; error?: string }> {
  const client = new ImapClient(s.host, s.port, s.use_tls);
  let processed = 0;
  try {
    await client.connect();
    await client.login(s.username, s.password);

    if (opts.onlyTest) {
      await client.logout();
      // Reset last_error on successful test
      try {
        await admin
          .from("imap_settings")
          .update({ last_error: null })
          .eq("id", s.id);
      } catch (_) {}
      return { ok: true, processed: 0 };
    }

    await client.selectFolder(s.folder || "INBOX");

    // Workflow par défaut → état initial
    const { data: defaultWf } = await admin
      .from("workflows")
      .select("id")
      .eq("organization_id", s.organization_id)
      .eq("is_default", true)
      .maybeSingle();

    let initialStateId: string | null = null;
    if (defaultWf?.id) {
      const { data: initState } = await admin
        .from("workflow_states")
        .select("id")
        .eq("workflow_id", defaultWf.id)
        .eq("is_initial", true)
        .maybeSingle();
      initialStateId = initState?.id ?? null;
    }

    // On scanne les emails reçus depuis 7 jours (au lieu de UNSEEN uniquement),
    // ce qui permet de rattraper les mails déjà lus dans le webmail. La
    // déduplication se fait sur Message-ID stocké dans couriers.metadata.
    const sinceDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const sinceStr = `${sinceDate.getUTCDate().toString().padStart(2,"0")}-${months[sinceDate.getUTCMonth()]}-${sinceDate.getUTCFullYear()}`;

    const uids = await client.search(`SINCE ${sinceStr}`);
    for (const uid of uids) {
      try {
        // 1) Lit d'abord juste l'en-tête pour récupérer Message-ID (économise la BP)
        const headerRaw = await client.fetchHeaders(uid);
        let earlyMessageId: string | null = null;
        if (headerRaw) {
          const m = headerRaw.match(/Message-ID:\s*<([^>]+)>/i);
          if (m) earlyMessageId = `<${m[1]}>`;
        }

        // 2) Si déjà importé, on saute sans toucher au flag Seen côté serveur
        if (earlyMessageId) {
          const { data: dup } = await admin
            .from("couriers")
            .select("id")
            .eq("organization_id", s.organization_id)
            .filter("metadata->>email_message_id", "eq", earlyMessageId)
            .maybeSingle();
          if (dup) continue;
        }

        const raw = await client.fetchMessage(uid);
        if (!raw) continue;
        // mailparser sous Deno ne supporte pas Uint8Array directement → on passe une string
        const rawStr = new TextDecoder("latin1").decode(raw);
        const parsed = await simpleParser(rawStr);
        const messageId = parsed.messageId || earlyMessageId || `imap-${s.organization_id}-${uid}`;

        const { data: existing } = await admin
          .from("couriers")
          .select("id")
          .eq("organization_id", s.organization_id)
          .filter("metadata->>email_message_id", "eq", messageId)
          .maybeSingle();
        if (existing) {
          continue;
        }

        const subject = parsed.subject?.slice(0, 500) || "(sans objet)";
        const receivedAt = (parsed.date || new Date()).toISOString();
        const fromAddr = (parsed.from as any)?.value?.[0];
        const senderName = fromAddr?.name || null;
        const senderEmail = fromAddr?.address || null;

        const { data: courier, error: courierErr } = await admin
          .from("couriers")
          .insert({
            organization_id: s.organization_id,
            direction: "inbound",
            channel: "email",
            subject,
            received_at: receivedAt,
            workflow_state_id: initialStateId,
            metadata: {
              email_message_id: messageId,
              email_from: senderEmail,
              email_to: s.username,
              body_text: parsed.text || null,
              body_html: parsed.html || null,
              source: "imap",
            },
          })
          .select("id")
          .single();

        if (courierErr || !courier) {
          console.error("Erreur insert courier", courierErr);
          continue;
        }

        const participants: any[] = [];
        if (senderEmail) {
          participants.push({
            organization_id: s.organization_id,
            courier_id: courier.id,
            role: "sender",
            name: senderName,
            email: senderEmail,
          });
        }
        participants.push({
          organization_id: s.organization_id,
          courier_id: courier.id,
          role: "recipient",
          email: s.username,
        });
        if (participants.length) {
          await admin.from("courier_participants").insert(participants);
        }

        if (parsed.attachments?.length) {
          for (const att of parsed.attachments) {
            try {
              const safeName = (att.filename || "attachment").replace(/[^\w.\-]+/g, "_");
              const storageKey = `org_${s.organization_id}/couriers/${courier.id}/${crypto.randomUUID()}-${safeName}`;
              const { error: upErr } = await admin.storage
                .from("clara-documents")
                .upload(storageKey, att.content as Uint8Array, {
                  contentType: att.contentType || "application/octet-stream",
                  upsert: false,
                });
              if (upErr) {
                console.error("Upload pièce jointe", upErr);
                continue;
              }
              await admin.from("courier_documents").insert({
                organization_id: s.organization_id,
                courier_id: courier.id,
                document_type: "attachment",
                file_name: att.filename || safeName,
                mime_type: att.contentType || null,
                file_size: (att.size as number) ?? null,
                storage_key: storageKey,
              });
            } catch (e) {
              console.error("Erreur traitement pièce jointe", e);
            }
          }
        }

        await admin.from("courier_events").insert({
          organization_id: s.organization_id,
          courier_id: courier.id,
          event_type: "email_received",
          payload: { from: senderEmail, subject, attachments: parsed.attachments?.length || 0 },
        });

        await client.markSeen(uid);
        processed++;
      } catch (e) {
        console.error("Erreur traitement message uid", uid, e);
      }
    }

    await client.logout();

    await admin
      .from("imap_settings")
      .update({ last_fetch_at: new Date().toISOString(), last_error: null })
      .eq("id", s.id);

    return { ok: true, processed };
  } catch (e: any) {
    const msg = e?.message || String(e);
    console.error("IMAP error", s.organization_id, msg);
    try {
      await admin
        .from("imap_settings")
        .update({ last_fetch_at: new Date().toISOString(), last_error: msg })
        .eq("id", s.id);
    } catch (_) {}
    try { await client.logout(); } catch (_) {}
    return { ok: false, processed, error: msg };
  }
}

// ===================== HTTP =====================

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    let body: any = {};
    try { body = await req.json(); } catch (_) {}

    const cronHeader = req.headers.get("x-cron-secret");
    const isCron = !!CRON_SECRET && cronHeader === CRON_SECRET;
    const onlyTest = body?.test === true;

    if (isCron && !body?.organization_id) {
      const { data: settings, error } = await admin
        .from("imap_settings")
        .select("*")
        .eq("auto_fetch", true)
        .neq("host", "");
      if (error) return jsonResponse(500, { ok: false, error: error.message });
      const results = [];
      for (const s of settings ?? []) {
        const r = await processOrganization(admin, s as ImapSettings);
        results.push({ organization_id: (s as any).organization_id, ...r });
      }
      return jsonResponse(200, { ok: true, success: true, results });
    }

    const orgId = body?.organization_id;
    if (!orgId) return jsonResponse(400, { ok: false, error: "organization_id requis" });

    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return jsonResponse(401, { ok: false, error: "Unauthorized" });
    }
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: authData, error: authErr } = await userClient.auth.getUser(token);
    if (authErr || !authData?.user) {
      return jsonResponse(401, { ok: false, error: "Unauthorized" });
    }
    const userId = authData.user.id;

    const { data: membership } = await admin
      .from("organization_users")
      .select("role")
      .eq("user_id", userId)
      .eq("organization_id", orgId)
      .maybeSingle();
    const { data: userRow } = await admin.from("users").select("is_superadmin").eq("id", userId).maybeSingle();
    const isAdmin = (userRow as any)?.is_superadmin ||
      ["admin", "administrateur"].includes((membership as any)?.role);
    if (!isAdmin) return jsonResponse(403, { ok: false, error: "Accès refusé" });

    const { data: s, error: sErr } = await admin
      .from("imap_settings")
      .select("*")
      .eq("organization_id", orgId)
      .maybeSingle();
    if (sErr || !s) return jsonResponse(404, { ok: false, error: "Configuration IMAP introuvable" });

    const result = await processOrganization(admin, s as ImapSettings, { onlyTest });
    return jsonResponse(200, { ok: result.ok, success: result.ok, ...result });
  } catch (e: any) {
    console.error("Unhandled error", e);
    return jsonResponse(200, { ok: false, error: e?.message || String(e) });
  }
});
