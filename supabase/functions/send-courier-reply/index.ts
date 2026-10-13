import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6";
import { assertEditor } from "../_shared/authz.ts";
import { contactsApiKeyForOrg, fetchContactsApi } from "../_shared/socleContactsClient.ts";
import { planOutboundAttachments, type OutboundDocument } from "../_shared/outboundAttachments.ts";

const BUCKET = "clara-documents";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-org-id, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function htmlToText(html: string): string {
  return html
    .replace(/<\/(p|div|br|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+\n/g, "\n")
    .trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Authenticate caller
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
    );
    const { data: userData, error: userErr } = await anonClient.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { reply_id, organization_id } = await req.json();
    if (!reply_id || !organization_id) {
      return new Response(
        JSON.stringify({ error: "Paramètres manquants (reply_id, organization_id)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Verify org membership
    const { data: membership } = await supabase
      .from("organization_users")
      .select("user_id")
      .eq("user_id", userData.user.id)
      .eq("organization_id", organization_id)
      .eq("is_active", true)
      .maybeSingle();
    if (!membership) {
      return new Response(JSON.stringify({ error: "Accès refusé" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Le consultant est en lecture seule : jamais d'envoi d'email en son nom.
    if (!(await assertEditor(supabase, userData.user.id, organization_id))) {
      return new Response(
        JSON.stringify({ error: "Accès refusé : rôle consultant en lecture seule" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Load reply courier
    const { data: reply, error: replyErr } = await supabase
      .from("couriers")
      .select("id, organization_id, channel, subject, metadata, parent_courier_id, direction")
      .eq("id", reply_id)
      .eq("organization_id", organization_id)
      .single();
    if (replyErr || !reply) {
      return new Response(JSON.stringify({ error: "Réponse introuvable" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // Un courrier REÇU par courriel a lui aussi `channel = email` : sans ce
    // contrôle, il était « envoyable ».
    if (reply.direction !== "outbound") {
      return json({ error: "Seul un courrier sortant s'envoie." }, 400);
    }
    if (reply.channel !== "email") {
      return new Response(JSON.stringify({ error: "Le canal de la réponse n'est pas email" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const meta = (reply.metadata as Record<string, unknown> | null) ?? {};
    if (meta.sent_email_at) {
      return new Response(JSON.stringify({ error: "Réponse déjà envoyée" }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Destinataire : le participant « recipient » du sortant ; pour une réponse,
    // à défaut, l'expéditeur du courrier reçu. Un courrier à l'initiative n'a
    // pas de repli : son destinataire est une fiche du référentiel.
    const { data: replyParts } = await supabase
      .from("courier_participants")
      .select("role, email, name, socle_contact_id")
      .eq("courier_id", reply.id);
    let recipient = (replyParts ?? []).find((p) => p.role === "recipient");
    if (!recipient?.email && reply.parent_courier_id) {
      const { data: parentParts } = await supabase
        .from("courier_participants")
        .select("role, email, name, socle_contact_id")
        .eq("courier_id", reply.parent_courier_id);
      recipient = (parentParts ?? []).find((p) => p.role === "sender") ?? recipient;
    }

    // Dernier recours : l'adresse tenue par le référentiel. Le participant
    // n'est qu'un instantané du dépôt — un email ajouté après coup sur la fiche
    // de l'usager n'y redescend jamais, et la réponse resterait impossible à
    // envoyer. Best-effort : un référentiel injoignable laisse l'erreur 400.
    if (!recipient?.email && recipient?.socle_contact_id) {
      try {
        const { data: org } = await supabase
          .from("organizations")
          .select("socle_org_id")
          .eq("id", organization_id)
          .single();
        const socleOrgId = (org?.socle_org_id as string | null) ?? null;
        const contactsKey = contactsApiKeyForOrg(socleOrgId);
        if (contactsKey) {
          const { body } = await fetchContactsApi(contactsKey, {
            method: "GET",
            path: `/v1/contacts/${recipient.socle_contact_id}`,
            idempotent: true,
          }, { socleOrgId });
          const referentialEmail = (body as { email?: string | null } | null)?.email?.trim();
          if (referentialEmail) recipient = { ...recipient, email: referentialEmail };
        }
      } catch (e) {
        console.warn("send-courier-reply: adresse du référentiel indisponible:", e);
      }
    }

    if (!reply.parent_courier_id && !recipient?.socle_contact_id) {
      return json({ error: "Ce courrier n'a pas de destinataire rattaché au référentiel des contacts." }, 400);
    }

    if (!recipient?.email) {
      return new Response(
        JSON.stringify({
          error:
            "Aucune adresse email destinataire : ni sur le courrier, ni sur la fiche du destinataire dans le référentiel.",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // SMTP config
    const { data: smtp, error: smtpErr } = await supabase
      .from("smtp_settings")
      .select("*")
      .eq("organization_id", organization_id)
      .single();
    // Le relais vient du référentiel (organisation principale) : Clara n'en tient
    // qu'un miroir et n'a aucun repli. Pas de miroir = pas d'envoi possible.
    if (smtpErr || !smtp) {
      await supabase.from("courier_events").insert({
        organization_id,
        courier_id: reply.parent_courier_id ?? reply.id,
        event_type: "reply_email_failed",
        payload: { reply_id: reply.id, reason: "Aucun serveur d'envoi" },
        created_by: userData.user.id,
      } as never);
      return new Response(JSON.stringify({
        error:
          "Aucun serveur d'envoi pour cette organisation : définissez-le dans le référentiel (organisation principale), puis lancez une synchronisation.",
      }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Pièces jointes du sortant (courrier à l'initiative seulement : une
    // réponse peut porter des documents qui n'étaient pas faits pour partir).
    const fileAttachments: { filename: string; content: Uint8Array; contentType: string }[] = [];
    if (!reply.parent_courier_id) {
      const { data: docs, error: docsErr } = await supabase
        .from("courier_documents")
        .select("id, organization_id, courier_id, file_name, mime_type, file_size, storage_key")
        .eq("courier_id", reply.id)
        .eq("organization_id", organization_id);
      if (docsErr) throw docsErr;
      const plan = planOutboundAttachments((docs ?? []) as OutboundDocument[], {
        courierId: reply.id,
        organizationId: organization_id,
      });
      if (plan.refusal) return json({ error: plan.refusal }, 413);
      for (const doc of plan.items) {
        const { data: blob, error: dlErr } = await supabase.storage.from(BUCKET).download(doc.storage_key!);
        if (dlErr || !blob) {
          return json({ error: `Pièce jointe illisible : ${doc.file_name ?? doc.id}. Rien n'est parti.` }, 502);
        }
        fileAttachments.push({
          filename: doc.file_name ?? "piece-jointe",
          content: new Uint8Array(await blob.arrayBuffer()),
          contentType: doc.mime_type ?? "application/octet-stream",
        });
      }
    }

    // Réservation : deux clics rapprochés, ou deux onglets, n'envoient qu'un
    // seul message. La lecture de `sent_email_at` plus haut ne suffisait pas.
    const { data: claimed, error: claimErr } = await supabase.rpc("claim_outbound_email_send", {
      p_courier_id: reply.id,
      p_organization_id: organization_id,
    });
    if (claimErr) throw claimErr;
    if (!claimed) return json({ error: "Envoi déjà en cours ou déjà fait." }, 409);

    // Le courrier qui porte l'historique : le parent d'une réponse, sinon lui-même.
    const anchorId = reply.parent_courier_id ?? reply.id;

    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port || 587,
      secure: smtp.use_tls && smtp.port === 465,
      auth: { user: smtp.username, pass: smtp.password },
      tls: smtp.use_tls ? { rejectUnauthorized: false } : undefined,
    });

    let html = (meta.body_html as string | undefined) ?? "";
    const text = (meta.body_text as string | undefined) ?? htmlToText(html);

    // Convert inline data: images (e.g. signature) into CID attachments so
    // that mail clients (Gmail, Outlook, Apple Mail) display them. Most
    // clients strip <img src="data:..."> for security reasons.
    const attachments: Array<{
      filename: string;
      content: Uint8Array;
      contentType: string;
      cid: string;
      contentDisposition: "inline";
    }> = [];
    html = html.replace(
      /src=(["'])data:([^;]+);base64,([^"']+)\1/gi,
      (_m, quote, mime, b64) => {
        const cid = `inline-${attachments.length}-${crypto.randomUUID()}@clara`;
        const ext = (mime.split("/")[1] || "bin").split("+")[0];
        const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        attachments.push({
          filename: `signature-${attachments.length}.${ext}`,
          content: bin,
          contentType: mime,
          cid,
          contentDisposition: "inline",
        });
        return `src=${quote}cid:${cid}${quote}`;
      },
    );

    const allAttachments = [...attachments, ...fileAttachments];
    let info: { messageId?: string };
    try {
      info = await transporter.sendMail({
        from: smtp.from_name ? `${smtp.from_name} <${smtp.from_email}>` : smtp.from_email,
        to: recipient.name ? `${recipient.name} <${recipient.email}>` : recipient.email,
        subject: reply.subject || "Réponse",
        text,
        html: html || text,
        attachments: allAttachments.length ? allAttachments : undefined,
      });
    } catch (sendErr) {
      // Rien n'est parti : on libère la réservation, et l'échec est tracé.
      await supabase.rpc("release_outbound_email_send", { p_courier_id: reply.id });
      await supabase.from("courier_events").insert({
        organization_id,
        courier_id: anchorId,
        event_type: "reply_email_failed",
        payload: { reply_id: reply.id, to: recipient.email, reason: (sendErr as Error).message?.slice(0, 300) ?? null },
        created_by: userData.user.id,
      } as never);
      return json({ error: `Le serveur d'envoi a refusé le courriel : ${(sendErr as Error).message}` }, 502);
    }

    await supabase.rpc("finish_outbound_email_send", {
      p_courier_id: reply.id,
      p_message_id: info.messageId ?? null,
    });

    await supabase.from("courier_events").insert({
      organization_id,
      courier_id: anchorId,
      event_type: "reply_email_sent",
      payload: {
        reply_id: reply.id,
        to: recipient.email,
        message_id: info.messageId ?? null,
        attachments: fileAttachments.length,
      },
      created_by: userData.user.id,
    } as never);

    return new Response(
      JSON.stringify({ success: true, message_id: info.messageId, to: recipient.email }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("send-courier-reply error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
