import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface SmtpSettings {
  host: string;
  port: number;
  username: string;
  password: string;
  from_email: string;
  from_name: string;
  use_tls: boolean;
}

interface OrgBranding {
  name: string;
  primary_color: string | null;
  secondary_color: string | null;
  logo_url: string | null;
}

async function sendViaSMTP(smtp: SmtpSettings, to: string, subject: string, html: string, text: string) {
  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port || 587,
    secure: smtp.use_tls && smtp.port === 465,
    auth: { user: smtp.username, pass: smtp.password },
    tls: smtp.use_tls ? { rejectUnauthorized: false } : undefined,
  });

  await transporter.sendMail({
    from: smtp.from_name ? `${smtp.from_name} <${smtp.from_email}>` : smtp.from_email,
    to,
    subject,
    text,
    html,
  });
}

function buildBrandedEmail(
  org: OrgBranding,
  heading: string,
  bodyHtml: string,
  ctaLabel: string,
  ctaUrl: string,
  isOtp = false,
) {
  const primary = org.primary_color || "#18181b";
  const secondary = org.secondary_color || "#f4f4f5";
  const siteName = org.name || "Clara";

  const logoHtml = org.logo_url
    ? `<img src="${org.logo_url}" alt="${siteName}" style="max-height:48px;max-width:200px;margin-bottom:0;" />`
    : `<h2 style="margin:0;color:#ffffff;font-size:20px;font-weight:700;">${siteName}</h2>`;

  const ctaBlock = isOtp
    ? `<div style="text-align:center;padding:16px;background:${secondary};border-radius:8px;font-size:28px;font-weight:700;letter-spacing:4px;color:#18181b;">${ctaUrl}</div>`
    : `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
        <tr><td style="background-color:${primary};border-radius:8px;">
          <a href="${ctaUrl}" target="_blank" style="display:inline-block;padding:14px 32px;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;">${ctaLabel}</a>
        </td></tr>
      </table>`;

  const fallbackLink = isOtp
    ? ""
    : `<p style="margin:20px 0 0;font-size:12px;color:#a1a1aa;word-break:break-all;">Si le bouton ne fonctionne pas, copiez ce lien : ${ctaUrl}</p>`;

  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:${secondary};font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${secondary};padding:40px 20px;">
    <tr><td align="center">
      <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <tr><td style="background-color:${primary};padding:24px 32px;text-align:center;">
          ${logoHtml}
        </td></tr>
        <tr><td style="padding:32px 32px 24px;">
          <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#18181b;">${heading}</h1>
          ${bodyHtml}
          ${ctaBlock}
        </td></tr>
        <tr><td style="padding:0 32px 28px;">
          ${fallbackLink}
          <hr style="border:none;border-top:1px solid #e4e4e7;margin:20px 0;" />
          <p style="margin:0;font-size:12px;color:#a1a1aa;text-align:center;">${siteName}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function getEmailContent(emailType: string, siteName: string) {
  const templates: Record<string, { subject: string; heading: string; body: string; cta: string }> = {
    recovery: {
      subject: `Réinitialisation de votre mot de passe — ${siteName}`,
      heading: "Réinitialisation de mot de passe",
      body: "Vous avez demandé la réinitialisation de votre mot de passe. Cliquez sur le bouton ci-dessous pour choisir un nouveau mot de passe.",
      cta: "Réinitialiser le mot de passe",
    },
    invite: {
      subject: `Activez votre compte — ${siteName}`,
      heading: "Bienvenue !",
      body: `Vous avez été invité(e) à rejoindre <strong>${siteName}</strong>. Cliquez sur le bouton ci-dessous pour définir votre mot de passe et activer votre compte.`,
      cta: "Activer mon compte",
    },
    signup: {
      subject: `Confirmez votre inscription — ${siteName}`,
      heading: "Confirmation d'inscription",
      body: "Merci de vous être inscrit(e). Veuillez confirmer votre adresse e-mail en cliquant sur le bouton ci-dessous.",
      cta: "Confirmer mon adresse e-mail",
    },
    magiclink: {
      subject: `Votre lien de connexion — ${siteName}`,
      heading: "Connexion par lien magique",
      body: "Cliquez sur le bouton ci-dessous pour vous connecter à votre compte.",
      cta: "Se connecter",
    },
    email_change: {
      subject: `Confirmation de changement d'e-mail — ${siteName}`,
      heading: "Changement d'adresse e-mail",
      body: "Vous avez demandé à changer votre adresse e-mail. Cliquez sur le bouton ci-dessous pour confirmer ce changement.",
      cta: "Confirmer le changement",
    },
    reauthentication: {
      subject: `Code de vérification — ${siteName}`,
      heading: "Code de vérification",
      body: "Voici votre code de vérification pour confirmer votre identité.",
      cta: "",
    },
  };

  return templates[emailType] || templates.recovery;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify shared secret to prevent unauthorized invocation.
    // Configure the same value in Supabase Dashboard → Auth → Hooks
    // (Send Email hook → "HTTP Headers") and as the AUTH_HOOK_SECRET edge
    // function secret.
    const expectedSecret = Deno.env.get("AUTH_HOOK_SECRET");
    if (!expectedSecret) {
      console.error("AUTH_HOOK_SECRET not configured");
      return new Response(JSON.stringify({ error: "Hook not configured" }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const provided =
      req.headers.get("x-auth-hook-secret") ??
      req.headers.get("webhook-secret") ??
      "";
    if (provided !== expectedSecret) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const payload = await req.json();
    const user = payload.user;
    const emailData = payload.email_data;

    if (!user?.email || !emailData) {
      return new Response(JSON.stringify({ error: "Payload invalide" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const emailType = emailData.email_action_type || "recovery";
    const tokenHash = emailData.token_hash || "";
    const token = emailData.token || "";
    const redirectTo = emailData.redirect_to || "";

    // Build confirmation URL
    let confirmationUrl: string;
    if (emailType === "reauthentication") {
      confirmationUrl = token;
    } else {
      const typeMap: Record<string, string> = {
        signup: "signup",
        recovery: "recovery",
        invite: "invite",
        magiclink: "magiclink",
        email_change: "email_change",
      };
      const verifyType = typeMap[emailType] || emailType;
      confirmationUrl = `${supabaseUrl}/auth/v1/verify?token=${tokenHash}&type=${verifyType}&redirect_to=${encodeURIComponent(redirectTo)}`;
    }

    // Find user's organization via organization_users
    const { data: orgUser } = await supabase
      .from("organization_users")
      .select("organization_id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();

    if (!orgUser?.organization_id) {
      console.error(`No organization found for user ${user.id}`);
      return new Response(JSON.stringify({ error: "Organisation introuvable" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const orgId = orgUser.organization_id;

    // Get org branding
    const { data: org } = await supabase
      .from("organizations")
      .select("name, primary_color, secondary_color, logo_url")
      .eq("id", orgId)
      .single();

    const orgBranding: OrgBranding = {
      name: org?.name || "Clara",
      primary_color: (org as any)?.primary_color || null,
      secondary_color: (org as any)?.secondary_color || null,
      logo_url: (org as any)?.logo_url || null,
    };

    // Get SMTP settings
    const { data: smtp, error: smtpError } = await supabase
      .from("smtp_settings")
      .select("*")
      .eq("organization_id", orgId)
      .single();

    if (smtpError || !smtp) {
      console.error(`No SMTP settings for org ${orgId}`);
      return new Response(JSON.stringify({ error: "Configuration SMTP introuvable" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const t = getEmailContent(emailType, orgBranding.name);
    const isOtp = emailType === "reauthentication";

    const bodyHtml = `<p style="margin:0 0 28px;font-size:14px;line-height:1.6;color:#52525b;">${t.body}</p>`;

    const html = buildBrandedEmail(orgBranding, t.heading, bodyHtml, t.cta, confirmationUrl, isOtp);
    const text = isOtp
      ? `${t.heading}\n\n${t.body}\n\nCode : ${confirmationUrl}\n\n${orgBranding.name}`
      : `${t.heading}\n\n${t.body}\n\n${t.cta} : ${confirmationUrl}\n\n${orgBranding.name}`;

    await sendViaSMTP(smtp as SmtpSettings, user.email, t.subject, html, text);

    console.log(`Auth email sent: type=${emailType}, to=${user.email}, org=${orgId}`);

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("auth-email-hook error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
