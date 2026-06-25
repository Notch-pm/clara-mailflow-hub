import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-org-id, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface OrgBranding {
  name: string;
  primary_color: string | null;
  secondary_color: string | null;
  logo_url: string | null;
}

function buildBrandedEmail(
  org: OrgBranding,
  heading: string,
  bodyHtml: string,
  ctaLabel: string,
  ctaUrl: string,
) {
  const primary = org.primary_color || "#0acf83";
  const siteName = org.name || "Clara";
  const logoHtml = org.logo_url
    ? `<img src="${org.logo_url}" alt="${siteName}" style="max-height:48px;max-width:200px;" />`
    : `<h2 style="margin:0;color:#ffffff;font-size:20px;font-weight:700;">${siteName}</h2>`;

  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background-color:#ffffff;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#ffffff;padding:40px 20px;">
<tr><td align="center">
<table role="presentation" width="520" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
<tr><td style="background-color:${primary};padding:24px 32px;text-align:center;">${logoHtml}</td></tr>
<tr><td style="padding:32px 32px 24px;">
<h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#18181b;">${heading}</h1>
${bodyHtml}
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr><td style="background-color:${primary};border-radius:8px;">
<a href="${ctaUrl}" target="_blank" style="display:inline-block;padding:14px 32px;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;">${ctaLabel}</a>
</td></tr></table>
</td></tr>
<tr><td style="padding:0 32px 28px;">
<p style="margin:20px 0 0;font-size:12px;color:#a1a1aa;word-break:break-all;">Si le bouton ne fonctionne pas, copiez ce lien : ${ctaUrl}</p>
<hr style="border:none;border-top:1px solid #e4e4e7;margin:20px 0;" />
<p style="margin:0;font-size:12px;color:#a1a1aa;text-align:center;">${siteName}</p>
</td></tr></table>
</td></tr></table></body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Non autorisé" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user: callerUser }, error: authError } = await callerClient.auth.getUser();
    if (authError || !callerUser) {
      return new Response(JSON.stringify({ error: "Non autorisé" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json().catch(() => ({}));
    const { courier_id, mentioned_user_ids } = body as { courier_id?: string; mentioned_user_ids?: string[] };
    if (!courier_id || !Array.isArray(mentioned_user_ids) || mentioned_user_ids.length === 0) {
      return new Response(JSON.stringify({ error: "Paramètres invalides" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);

    // Fetch courier + verify caller membership
    const { data: courier } = await admin
      .from("couriers")
      .select("id, subject, organization_id")
      .eq("id", courier_id)
      .single();
    if (!courier) {
      return new Response(JSON.stringify({ error: "Courrier introuvable" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: callerMembership } = await admin
      .from("organization_users")
      .select("id")
      .eq("user_id", callerUser.id)
      .eq("organization_id", courier.organization_id)
      .maybeSingle();
    if (!callerMembership) {
      return new Response(JSON.stringify({ error: "Accès refusé" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Caller info
    const { data: caller } = await admin
      .from("users")
      .select("first_name, last_name, email")
      .eq("id", callerUser.id)
      .single();
    const authorName = [caller?.first_name, caller?.last_name].filter(Boolean).join(" ").trim() || caller?.email || "Un utilisateur";

    // Recipients: must be members of same org, exclude self
    const targetIds = mentioned_user_ids.filter((id) => id && id !== callerUser.id);
    if (targetIds.length === 0) {
      return new Response(JSON.stringify({ success: true, sent: 0 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const { data: memberships } = await admin
      .from("organization_users")
      .select("user_id")
      .eq("organization_id", courier.organization_id)
      .in("user_id", targetIds);
    const allowedIds = new Set((memberships ?? []).map((m: { user_id: string }) => m.user_id));
    const recipientIds = targetIds.filter((id) => allowedIds.has(id));
    if (recipientIds.length === 0) {
      return new Response(JSON.stringify({ success: true, sent: 0 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: recipients } = await admin
      .from("users")
      .select("id, email, first_name, last_name")
      .in("id", recipientIds);

    const { data: org } = await admin
      .from("organizations")
      .select("name, primary_color, secondary_color, logo_url")
      .eq("id", courier.organization_id)
      .single();

    const { data: smtp } = await admin
      .from("smtp_settings")
      .select("*")
      .eq("organization_id", courier.organization_id)
      .single();

    if (!smtp?.host) {
      return new Response(JSON.stringify({ error: "Configuration SMTP introuvable" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const origin = Deno.env.get("APP_ORIGIN") || req.headers.get("origin") || supabaseUrl.replace(".supabase.co", ".lovableproject.com");
    const link = `${origin}/courrier/${courier.id}`;
    const siteName = org?.name || "Clara";
    const subjectLine = courier.subject || "(sans objet)";

    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port || 587,
      secure: smtp.use_tls && smtp.port === 465,
      auth: { user: smtp.username, pass: smtp.password },
      tls: smtp.use_tls ? { rejectUnauthorized: false } : undefined,
    });

    const orgBranding: OrgBranding = {
      name: siteName,
      primary_color: org?.primary_color || null,
      secondary_color: org?.secondary_color || null,
      logo_url: org?.logo_url || null,
    };

    let sent = 0;
    for (const r of recipients ?? []) {
      if (!r.email) continue;
      const greetingName = [r.first_name, r.last_name].filter(Boolean).join(" ").trim();
      const greeting = greetingName ? `Bonjour ${greetingName},` : "Bonjour,";
      const bodyHtml = `<p style="margin:0 0 8px;font-size:14px;line-height:1.6;color:#52525b;">${escapeHtml(greeting)}</p>
        <p style="margin:0 0 28px;font-size:14px;line-height:1.6;color:#52525b;"><strong>${escapeHtml(authorName)}</strong> vient de vous mentionner dans une note interne du courrier <strong>${escapeHtml(subjectLine)}</strong>.</p>`;
      const html = buildBrandedEmail(orgBranding, "Vous avez été mentionné", bodyHtml, "Voir le courrier", link);
      const text = `${greeting}\n\n${authorName} vient de vous mentionner dans une note interne du courrier « ${subjectLine} ».\n\nVoir le courrier : ${link}\n\n${siteName}`;
      try {
        await transporter.sendMail({
          from: smtp.from_name ? `${smtp.from_name} <${smtp.from_email}>` : smtp.from_email,
          to: r.email,
          subject: `Mention dans une note — ${subjectLine}`,
          text,
          html,
        });
        sent++;
      } catch (e) {
        console.error("send-mention-notification mail error:", r.email, e);
      }
    }

    return new Response(JSON.stringify({ success: true, sent }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("send-mention-notification error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
