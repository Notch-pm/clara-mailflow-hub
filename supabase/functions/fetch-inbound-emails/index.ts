// Edge function: fetch-inbound-emails
// Récupère les emails non lus via IMAP pour chaque organisation et les transforme en couriers.
// Modes:
//  - POST avec body { organization_id } => fetch ciblé (auth user, droit admin requis)
//  - POST avec header x-cron-secret      => fetch global (cron toutes les 5 min)

import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { ImapFlow } from "npm:imapflow@1.0.164";
import { simpleParser } from "npm:mailparser@3.7.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
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

async function processOrganization(
  admin: ReturnType<typeof createClient>,
  s: ImapSettings,
  opts: { onlyTest?: boolean } = {},
): Promise<{ ok: boolean; processed: number; error?: string }> {
  const client = new ImapFlow({
    host: s.host,
    port: s.port,
    secure: s.use_tls,
    auth: { user: s.username, pass: s.password },
    logger: false,
  });

  let processed = 0;
  try {
    await client.connect();
    if (opts.onlyTest) {
      await client.logout();
      return { ok: true, processed: 0 };
    }

    const lock = await client.getMailboxLock(s.folder || "INBOX");
    try {
      // Récupère l'état initial du workflow par défaut de l'organisation
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

      // Recherche des messages UNSEEN
      const uids = (await client.search({ seen: false }, { uid: true })) || [];

      for (const uid of uids) {
        try {
          const msg = await client.fetchOne(
            String(uid),
            { source: true, envelope: true, internalDate: true, uid: true },
            { uid: true },
          );
          if (!msg?.source) continue;

          const parsed = await simpleParser(msg.source as Uint8Array);
          const messageId = parsed.messageId || `imap-${s.organization_id}-${uid}`;

          // Déduplication
          const { data: existing } = await admin
            .from("couriers")
            .select("id")
            .eq("organization_id", s.organization_id)
            .filter("metadata->>email_message_id", "eq", messageId)
            .maybeSingle();
          if (existing) {
            await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
            continue;
          }

          const subject = parsed.subject?.slice(0, 500) || "(sans objet)";
          const receivedAt = (parsed.date || msg.internalDate || new Date()).toISOString();
          const fromAddr = parsed.from?.value?.[0];
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

          // Participants
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

          // Pièces jointes
          if (parsed.attachments?.length) {
            for (const att of parsed.attachments) {
              try {
                const safeName = (att.filename || "attachment").replace(/[^\w.\-]+/g, "_");
                const storageKey = `${s.organization_id}/${courier.id}/${crypto.randomUUID()}-${safeName}`;
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

          await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
          processed++;
        } catch (e) {
          console.error("Erreur traitement message uid", uid, e);
        }
      }
    } finally {
      lock.release();
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const url = new URL(req.url);
  let body: any = {};
  try { body = await req.json(); } catch (_) {}

  const cronHeader = req.headers.get("x-cron-secret");
  const isCron = !!CRON_SECRET && cronHeader === CRON_SECRET;
  const onlyTest = body?.test === true;

  // Mode CRON: toutes les organisations avec auto_fetch=true
  if (isCron && !body?.organization_id) {
    const { data: settings, error } = await admin
      .from("imap_settings")
      .select("*")
      .eq("auto_fetch", true)
      .neq("host", "");
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const results = [];
    for (const s of settings ?? []) {
      const r = await processOrganization(admin, s as ImapSettings);
      results.push({ organization_id: s.organization_id, ...r });
    }
    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Mode utilisateur: vérifier auth + droit admin sur l'organisation
  const orgId = body?.organization_id;
  if (!orgId) {
    return new Response(JSON.stringify({ error: "organization_id requis" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const token = authHeader.replace("Bearer ", "");
  const { data: claims, error: claimsErr } = await userClient.auth.getClaims(token);
  if (claimsErr || !claims?.claims?.sub) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const userId = claims.claims.sub;

  // Vérification rôle admin
  const { data: membership } = await admin
    .from("organization_users")
    .select("role")
    .eq("user_id", userId)
    .eq("organization_id", orgId)
    .maybeSingle();
  const { data: userRow } = await admin.from("users").select("is_superadmin").eq("id", userId).maybeSingle();
  const isAdmin = userRow?.is_superadmin || ["admin", "administrateur"].includes((membership as any)?.role);
  if (!isAdmin) {
    return new Response(JSON.stringify({ error: "Accès refusé" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: s, error: sErr } = await admin
    .from("imap_settings")
    .select("*")
    .eq("organization_id", orgId)
    .maybeSingle();
  if (sErr || !s) {
    return new Response(JSON.stringify({ error: "Configuration IMAP introuvable" }), {
      status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const result = await processOrganization(admin, s as ImapSettings, { onlyTest });
  return new Response(JSON.stringify({ success: result.ok, ...result }), {
    status: result.ok ? 200 : 500,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
