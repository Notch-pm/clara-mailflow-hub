import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
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

    // Recipient = participant of the reply with role=recipient (fallback: parent sender)
    const { data: replyParts } = await supabase
      .from("courier_participants")
      .select("role, email, name")
      .eq("courier_id", reply.id);
    let recipient = (replyParts ?? []).find((p) => p.role === "recipient");
    if (!recipient?.email && reply.parent_courier_id) {
      const { data: parentParts } = await supabase
        .from("courier_participants")
        .select("role, email, name")
        .eq("courier_id", reply.parent_courier_id);
      recipient = (parentParts ?? []).find((p) => p.role === "sender") ?? recipient;
    }
    if (!recipient?.email) {
      return new Response(JSON.stringify({ error: "Aucune adresse email destinataire" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // SMTP config
    const { data: smtp, error: smtpErr } = await supabase
      .from("smtp_settings")
      .select("*")
      .eq("organization_id", organization_id)
      .single();
    if (smtpErr || !smtp) {
      return new Response(JSON.stringify({ error: "Configuration SMTP introuvable" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port || 587,
      secure: smtp.use_tls && smtp.port === 465,
      auth: { user: smtp.username, pass: smtp.password },
      tls: smtp.use_tls ? { rejectUnauthorized: false } : undefined,
    });

    const html = (meta.body_html as string | undefined) ?? "";
    const text = (meta.body_text as string | undefined) ?? htmlToText(html);

    const info = await transporter.sendMail({
      from: smtp.from_name ? `${smtp.from_name} <${smtp.from_email}>` : smtp.from_email,
      to: recipient.name ? `${recipient.name} <${recipient.email}>` : recipient.email,
      subject: reply.subject || "Réponse",
      text,
      html: html || text,
    });

    const sentAt = new Date().toISOString();
    await supabase
      .from("couriers")
      .update({
        metadata: { ...meta, sent_email_at: sentAt, sent_email_message_id: info.messageId ?? null },
        sent_at: sentAt,
      } as never)
      .eq("id", reply.id);

    if (reply.parent_courier_id) {
      await supabase.from("courier_events").insert({
        organization_id,
        courier_id: reply.parent_courier_id,
        event_type: "reply_email_sent",
        payload: { reply_id: reply.id, to: recipient.email, message_id: info.messageId ?? null },
      } as never);
    }

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
