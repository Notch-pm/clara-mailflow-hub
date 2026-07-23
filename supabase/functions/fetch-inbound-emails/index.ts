// Edge function: fetch-inbound-emails
// Récupère les emails non lus via IMAP pour chaque organisation et les transforme en couriers.
// Modes:
//  - POST avec body { organization_id, test? } => fetch ciblé (auth user, droit admin requis)
//  - POST avec header x-cron-secret             => fetch global (cron toutes les 5 min)
//
// Implémentation IMAP minimale via Deno.connectTls (compatible edge runtime).

import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { simpleParser } from "npm:mailparser@3.7.1";
import { isInboundSenderAccepted } from "./logic.ts";

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

// 15 Mo. Auparavant 2 Mo, et l'email dépassant la limite était SAUTÉ sans laisser
// de trace en base : un courrier numérisé (toujours au-delà de 2 Mo) disparaissait
// silencieusement. On les importe désormais, en les marquant « volumineux ».
const MAX_EMAIL_BYTES = 15 * 1024 * 1024;
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

// Seuil d'affichage du drapeau « courrier volumineux » dans la boîte aux lettres.
// C'est l'ancienne limite : au-delà, le courrier mérite un coup d'œil (scan lourd,
// pièce jointe inhabituelle) même s'il est désormais importé normalement.
const LARGE_EMAIL_BYTES = 2 * 1024 * 1024;

// Garde-fou mémoire : la limite par email ne suffit plus, car 10 × 15 Mo
// dépasseraient le quota de l'edge function. On borne le CUMUL traité par
// exécution ; le reste sera repris au passage suivant du cron (la déduplication
// par Message-ID rend l'opération sûre).
const MAX_RUN_BYTES = 45 * 1024 * 1024;

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
  /** Boîte alimentée par un copieur — voir migration 20260719100000. */
  is_scan_inbox?: boolean | null;
  scan_allowed_senders?: string[] | null;
  max_email_bytes?: number | null;
  socle_organization_id?: string | null;
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

    // Auto-assignation : l'organisation (miroir Socle) propriétaire de la boîte est
    // prioritaire ; fallback legacy sur le lien services.imap_settings_id tant que
    // toutes les boîtes ne sont pas rattachées à une organisation.
    let autoService: { name: string; workflowStateId: string | null } | null = null;
    if (s.socle_organization_id) {
      const { data: socleOrg } = await admin
        .from("socle_organizations")
        .select("id, name, workflow_id")
        .eq("id", s.socle_organization_id)
        .maybeSingle();
      if (socleOrg) {
        let orgInitStateId: string | null = null;
        if ((socleOrg as any).workflow_id) {
          const { data: initState } = await admin
            .from("workflow_states")
            .select("id")
            .eq("workflow_id", (socleOrg as any).workflow_id)
            .eq("is_initial", true)
            .maybeSingle();
          orgInitStateId = (initState as any)?.id ?? null;
        }
        autoService = { name: (socleOrg as any).name, workflowStateId: orgInitStateId };
      }
    }

    if (!autoService) {
      // Legacy : services liés à cette configuration IMAP (tables services gelées).
      const { data: linkedServices } = await admin
        .from("services")
        .select("id, name, workflow_id")
        .eq("organization_id", s.organization_id)
        .eq("imap_settings_id", s.id);

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
    let runBytes = 0;
    for (const uid of uids) {
      try {
        // 1) Récupère taille + Message-ID en un seul aller-retour IMAP
        const { size, messageId: earlyMessageId } = await client.fetchSizeAndMessageId(uid);

        // 2) Email hors gabarit : seul cas encore ignoré (15 Mo, surchargeable
        //    par boîte pour un copieur réglé en haute résolution).
        const maxEmailBytes = s.max_email_bytes ?? MAX_EMAIL_BYTES;
        if (size > maxEmailBytes) {
          console.error(`Email uid=${uid} ignoré (trop volumineux : ${size} bytes)`);
          continue;
        }

        // 2 bis) Budget mémoire de l'exécution épuisé : on s'arrête proprement,
        // le cron reprendra où il en est.
        if (runBytes + size > MAX_RUN_BYTES) {
          console.log(`Budget mémoire atteint (${runBytes} bytes) — reprise au prochain passage`);
          break;
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
        runBytes += size;
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

        const receivedAt = (parsed.date || new Date()).toISOString();
        const fromAddr = (parsed.from as any)?.value?.[0];
        const senderName = fromAddr?.name || null;
        const senderEmail = fromAddr?.address || null;

        const isScan = s.is_scan_inbox === true;

        // Une boîte de numérisation n'attend QUE ses copieurs (FAIL-CLOSED) : une
        // allowlist nulle OU vide ne laisse RIEN entrer. Sans ce filtre, quiconque
        // connaît l'adresse crée des courriers dans le tenant. (cf. logic.ts)
        if (!isInboundSenderAccepted(isScan, s.scan_allowed_senders, senderEmail)) {
          console.error(
            `Scan uid=${uid} rejeté : expéditeur non autorisé (${senderEmail?.toLowerCase() || "inconnu"})`,
          );
          continue;
        }

        // Le sujet produit par un copieur est du bruit (« Scan from RICOH
        // MP C3004 ») : il ferait un mauvais titre de courrier et polluerait la
        // recherche plein texte. Le vrai titre viendra de l'analyse IA
        // (courier_analyses.suggested_subject).
        const subject = isScan
          ? "Courrier numérisé — à qualifier"
          : (parsed.subject?.slice(0, 500) || "(sans objet)");

        // Construit une seule fois : tout update ultérieur repart de cet objet,
        // sinon on perd des clés (cf. ignored_attachments plus bas).
        const courierMetadata: Record<string, unknown> = {
          email_message_id: messageId,
          email_from: senderEmail,
          email_to: s.username,
          // Idem : le corps d'un mail de copieur est un pavé technique, qu'on
          // n'indexe pas dans fts_body.
          body_text: isScan ? null : (parsed.text || null),
          body_html: isScan ? null : (parsed.html || null),
          source: isScan ? "scan" : "imap",
          imap_settings_id: s.id,
          email_size_bytes: size,
          // Remonté jusqu'à la liste (search_couriers) pour signaler à l'agent
          // un courrier lourd — typiquement un scan — avant qu'il ne l'ouvre.
          is_large_email: size > LARGE_EMAIL_BYTES,
          ...(isScan
            ? {
                // L'adresse du copieur : traçabilité du périphérique, sans
                // jamais la confondre avec l'expéditeur du courrier.
                scan_device_email: senderEmail,
                needs_qualification: true,
              }
            : {}),
        };

        const { data: courier, error: courierErr } = await admin
          .from("couriers")
          .insert({
            organization_id: s.organization_id,
            direction: "inbound",
            // Un courrier numérisé est un courrier PAPIER : l'email n'est que
            // son moyen de transport depuis le copieur.
            channel: isScan ? "paper" : "email",
            subject,
            received_at: receivedAt,
            assigned_service: autoService?.name ?? null,
            // Organisation (miroir Socle) propriétaire de la boîte → tracée sur le courrier
            socle_organization_id: s.socle_organization_id ?? null,
            workflow_state_id: autoService?.workflowStateId ?? initialStateId,
            metadata: courierMetadata,
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
        // Sur une boîte de numérisation, le From: est le COPIEUR. L'enregistrer
        // en expéditeur donnerait à chaque courrier scanné le même expéditeur
        // fictif, et fausserait le rapprochement avec les contacts du Socle.
        // Le véritable expéditeur sera proposé par l'analyse IA.
        if (senderEmail && !isScan) {
          // Données brutes du From: — le rapprochement avec un contact Socle se
          // fait au passage en instruction (côté frontend), jamais ici.
          participants.push({
            organization_id: s.organization_id,
            courier_id: courier.id,
            role: "sender",
            name: senderName,
            first_name: senderFirstName,
            last_name: senderLastName || senderEmail,
            email: senderEmail,
            socle_contact_id: null,
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
        let storedDocuments = 0;
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
              storedDocuments++;
            } catch (e) {
              console.error("Erreur traitement pièce jointe", e);
            }
          }
        }

        if (ignoredAttachments.length > 0) {
          await admin.from("couriers").update({
            metadata: { ...courierMetadata, ignored_attachments: ignoredAttachments },
          }).eq("id", courier.id);
        }

        await admin.from("courier_events").insert({
          organization_id: s.organization_id,
          courier_id: courier.id,
          // event_type est un varchar libre : aucun enum à migrer.
          event_type: isScan ? "scan_received" : "email_received",
          payload: { from: senderEmail, subject, attachments: parsed.attachments?.length || 0 },
        });

        // Enfile l'OCR + l'analyse. Indispensable pour la numérisation : personne
        // n'est devant l'écran pour cliquer « Analyser », et sans extraits le
        // courrier n'a ni titre exploitable ni expéditeur suggéré. Le traitement
        // lui-même est fait par process-analysis-queue, hors de cette exécution.
        if (storedDocuments > 0) {
          const { error: jobErr } = await admin.from("courier_analysis_jobs").insert({
            organization_id: s.organization_id,
            courier_id: courier.id,
            kind: "full",
          });
          // Un conflit signifie qu'un job existe déjà : ce n'est pas une erreur.
          if (jobErr && !jobErr.message.includes("duplicate key")) {
            console.error("Enfilement analyse", jobErr.message);
          }
        }

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
