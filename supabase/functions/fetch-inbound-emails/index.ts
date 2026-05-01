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

// Lit le secret cron partagé directement depuis le Vault Postgres via RPC service_role.
async function getCronSecret(admin: ReturnType<typeof createClient>): Promise<string> {
  try {
    const { data, error } = await admin.rpc("get_cron_secret");
    if (error) {
      console.error("get_cron_secret RPC error:", error.message);
      return "";
    }
    return (data as string) ?? "";
  } catch (e) {
    console.error("get_cron_secret exception:", e);
    return "";
  }
}

const MAX_EMAILS_PER_RUN = 10;
const MAX_EMAIL_BYTES = 2 * 1024 * 1024;       // 2 MB — emails plus lourds sont ignorés
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;  // 5 MB

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
  last_fetch_at?: string | null;
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
   * Récupère en un seul aller-retour la taille et le Message-ID.
   * Permet de décider si l'email vaut la peine d'être téléchargé.
   */
  async fetchSizeAndMessageId(uid: number): Promise<{ size: number; messageId: string | null }> {
    const r = await this.command(`UID FETCH ${uid} (RFC822.SIZE BODY.PEEK[HEADER.FIELDS (MESSAGE-ID)])`);
    if (!r.ok) return { size: 0, messageId: null };
    let size = 0;
    for (const line of r.lines) {
      const m = line.match(/RFC822\.SIZE\s+(\d+)/i);
      if (m) { size = parseInt(m[1], 10); break; }
    }
    let messageId: string | null = null;
    if (r.literals[0]) {
      const header = new TextDecoder("latin1").decode(r.literals[0]);
      const m = header.match(/Message-ID:\s*<([^>]+)>/i);
      if (m) messageId = `<${m[1]}>`;
    }
    return { size, messageId };
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

    // Services liés à cette configuration IMAP.
    const { data: linkedServices } = await admin
      .from("services")
      .select("id, name, workflow_id")
      .eq("organization_id", s.organization_id)
      .eq("imap_settings_id", s.id);

    let autoService: { name: string; workflowStateId: string | null } | null = null;
    if (linkedServices?.length === 1) {
      const svc = linkedServices[0] as { id: string; name: string; workflow_id: string };
      const { data: initState } = await admin
        .from("workflow_states")
        .select("id")
        .eq("workflow_id", svc.workflow_id)
        .eq("is_initial", true)
        .maybeSingle();
      autoService = {
        name: svc.name,
        workflowStateId: (initState as any)?.id ?? null,
      };
    }

    // Utilise last_fetch_at comme point de départ (fallback : 7 jours).
    // La déduplication par Message-ID évite les doublons.
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const sinceDate = s.last_fetch_at
      ? new Date(new Date(s.last_fetch_at).getTime() - 60 * 60 * 1000) // 1h de recouvrement
      : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const sinceStr = `${sinceDate.getUTCDate().toString().padStart(2,"0")}-${months[sinceDate.getUTCMonth()]}-${sinceDate.getUTCFullYear()}`;

    const allUids = await client.search(`SINCE ${sinceStr}`);
    // On limite à MAX_EMAILS_PER_RUN en prenant les plus récents (UIDs les plus grands)
    const uids = allUids.slice(-MAX_EMAILS_PER_RUN);
    for (const uid of uids) {
      try {
        // 1) Récupère taille + Message-ID en un seul aller-retour IMAP
        const { size, messageId: earlyMessageId } = await client.fetchSizeAndMessageId(uid);

        // 2) Email trop lourd : on le saute entièrement pour rester sous le quota mémoire
        if (size > MAX_EMAIL_BYTES) {
          console.error(`Email uid=${uid} ignoré (trop volumineux : ${size} bytes)`);
          continue;
        }

        // 3) Si déjà importé, on saute
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
            assigned_service: autoService?.name ?? null,
            workflow_state_id: autoService?.workflowStateId ?? initialStateId,
            metadata: {
              email_message_id: messageId,
              email_from: senderEmail,
              email_to: s.username,
              body_text: parsed.text || null,
              body_html: parsed.html || null,
              source: "imap",
              imap_settings_id: s.id,
            },
          })
          .select("id")
          .single();

        if (courierErr || !courier) {
          console.error("Erreur insert courier", courierErr);
          continue;
        }

        // Découpe "Prénom Nom" → { firstName, lastName }
        const splitName = (full: string | null): { firstName: string | null; lastName: string | null } => {
          if (!full?.trim()) return { firstName: null, lastName: null };
          const parts = full.trim().split(/\s+/);
          if (parts.length === 1) return { firstName: null, lastName: parts[0] };
          return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
        };
        const { firstName: senderFirstName, lastName: senderLastName } = splitName(senderName);

        const participants: any[] = [];
        if (senderEmail) {
          // L'usager sera créé uniquement lors du passage en instruction (côté frontend).
          participants.push({
            organization_id: s.organization_id,
            courier_id: courier.id,
            role: "sender",
            name: senderName,
            first_name: senderFirstName,
            last_name: senderLastName || senderEmail,
            email: senderEmail,
            usager_id: null,
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

        const ignoredAttachments: { name: string; size: number }[] = [];
        if (parsed.attachments?.length) {
          for (const att of parsed.attachments) {
            try {
              if (att.content && (att.content as Uint8Array).byteLength > MAX_ATTACHMENT_BYTES) {
                ignoredAttachments.push({ name: att.filename || "attachment", size: (att.content as Uint8Array).byteLength });
                continue;
              }
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

        if (ignoredAttachments.length > 0) {
          await admin.from("couriers").update({
            metadata: {
              email_message_id: messageId,
              email_from: senderEmail,
              email_to: s.username,
              body_text: parsed.text || null,
              body_html: parsed.html || null,
              source: "imap",
              ignored_attachments: ignoredAttachments,
            },
          }).eq("id", courier.id);
        }

        await admin.from("courier_events").insert({
          organization_id: s.organization_id,
          courier_id: courier.id,
          event_type: "email_received",
          payload: { from: senderEmail, subject, attachments: parsed.attachments?.length || 0 },
        });

        // Volontairement, on ne marque pas l'email comme lu côté serveur IMAP :
        // ainsi le webmail / client mail conserve son propre statut. La
        // déduplication par Message-ID empêche les imports en double.
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
    const cronSecret = cronHeader ? await getCronSecret(admin) : "";
    const isCron = !!cronSecret && cronHeader === cronSecret;
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

    const settingsId = body?.settings_id;
    const baseQuery = admin.from("imap_settings").select("*").eq("organization_id", orgId);
    const { data: s, error: sErr } = settingsId
      ? await baseQuery.eq("id", settingsId).maybeSingle()
      : await (baseQuery as any).limit(1).maybeSingle();
    if (sErr || !s) return jsonResponse(404, { ok: false, error: "Configuration IMAP introuvable" });

    const result = await processOrganization(admin, s as ImapSettings, { onlyTest });
    return jsonResponse(200, { ok: result.ok, success: result.ok, ...result });
  } catch (e: any) {
    console.error("Unhandled error", e);
    return jsonResponse(200, { ok: false, error: e?.message || String(e) });
  }
});
