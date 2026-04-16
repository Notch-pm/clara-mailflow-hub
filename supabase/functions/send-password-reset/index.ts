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

function buildBrandedEmail(
  org: OrgBranding,
  heading: string,
  bodyHtml: string,
  ctaLabel: string,
  ctaUrl: string,
) {
  const primary = org.primary_color || "#18181b";
  const secondary = org.secondary_color || "#f4f4f5";
  const siteName = org.name || "Clara";

  const logoHtml = org.logo_url
    ? `<img src="${org.logo_url}" alt="${siteName}" style="max-height:48px;max-width:200px;margin-bottom:0;" />`
    : `<h2 style="margin:0;color:#ffffff;font-size:20px;font-weight:700;">${siteName}</h2>`;

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
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
            <tr><td style="background-color:${primary};border-radius:8px;">
              <a href="${ctaUrl}" target="_blank" style="display:inline-block;padding:14px 32px;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;">${ctaLabel}</a>
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:0 32px 28px;">
          <p style="margin:20px 0 0;font-size:12px;color:#a1a1aa;word-break:break-all;">Si le bouton ne fonctionne pas, copiez ce lien : ${ctaUrl}</p>
          <hr style="border:none;border-top:1px solid #e4e4e7;margin:20px 0;" />
          <p style="margin:0;font-size:12px;color:#a1a1aa;text-align:center;">${siteName}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Non autorisé" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const callerClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user: callerUser }, error: authError } = await callerClient.auth.getUser();
    if (authError || !callerUser) {
      return new Response(JSON.stringify({ error: "Non autorisé" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Check caller is admin or superadmin
    const { data: callerUser_ } = await adminClient
      .from("users")
      .select("is_superadmin")
      .eq("id", callerUser.id)
      .single();

    const { data: callerOrgUser } = await adminClient
      .from("organization_users")
      .select("role, organization_id")
      .eq("user_id", callerUser.id)
      .limit(1)
      .maybeSingle();

    const isSuperAdmin = callerUser_?.is_superadmin === true;
    const isOrgAdmin = callerOrgUser?.role === "admin";

    if (!isSuperAdmin && !isOrgAdmin) {
      return new Response(JSON.stringify({ error: "Accès réservé aux administrateurs" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { user_id } = await req.json();
    if (!user_id || typeof user_id !== "string") {
      return new Response(JSON.stringify({ error: "user_id requis" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get target user profile
    const { data: targetUser_ } = await adminClient
      .from("users")
      .select("first_name, last_name")
      .eq("id", user_id)
      .single();

    if (!targetUser_) {
      return new Response(JSON.stringify({ error: "Utilisateur introuvable" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get target user's org
    const { data: targetOrgUser } = await adminClient
      .from("organization_users")
      .select("organization_id")
      .eq("user_id", user_id)
      .limit(1)
      .maybeSingle();

    // Get user email from auth
    const { data: { user: targetAuthUser }, error: targetAuthError } = await adminClient.auth.admin.getUserById(user_id);
    if (targetAuthError || !targetAuthUser?.email) {
      console.error("getUserById failed:", targetAuthError?.message, "for user_id:", user_id);
      return new Response(JSON.stringify({ error: "Email utilisateur introuvable" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const origin = Deno.env.get("APP_ORIGIN") || supabaseUrl.replace(".supabase.co", ".lovableproject.com");
    const redirectTo = `${origin}/reset-password`;

    const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
      type: "recovery",
      email: targetAuthUser.email,
      options: { redirectTo },
    });

    if (linkError) {
      return new Response(JSON.stringify({ error: linkError.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const tokenHash = linkData?.properties?.hashed_token || "";
    if (!tokenHash) {
      console.error("generateLink returned no hashed_token");
    }
    const resetLink = `${origin}/reset-password?token_hash=${encodeURIComponent(tokenHash)}&type=recovery`;

    // Get org branding + SMTP
    const orgId = targetOrgUser?.organization_id || callerOrgUser?.organization_id;

    if (!orgId) {
      return new Response(JSON.stringify({ error: "Organisation introuvable" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: org } = await adminClient
      .from("organizations")
      .select("name, primary_color, secondary_color, logo_url")
      .eq("id", orgId)
      .single();

    const { data: smtp } = await adminClient
      .from("smtp_settings")
      .select("*")
      .eq("organization_id", orgId)
      .single();

    if (!smtp?.host) {
      return new Response(JSON.stringify({ error: "Configuration SMTP introuvable" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const siteName = org?.name || "Clara";
    const displayName = [targetUser_.first_name, targetUser_.last_name].filter(Boolean).join(" ");
    const greeting = displayName ? `Bonjour ${displayName},` : "Bonjour,";

    const bodyHtml = `<p style="margin:0 0 8px;font-size:14px;line-height:1.6;color:#52525b;">${greeting}</p>
      <p style="margin:0 0 28px;font-size:14px;line-height:1.6;color:#52525b;">Vous avez demandé la réinitialisation de votre mot de passe. Cliquez sur le bouton ci-dessous pour choisir un nouveau mot de passe.</p>`;

    const orgBranding: OrgBranding = {
      name: siteName,
      primary_color: org?.primary_color || null,
      secondary_color: org?.secondary_color || null,
      logo_url: org?.logo_url || null,
    };

    const html = buildBrandedEmail(
      orgBranding,
      "Réinitialisation de mot de passe",
      bodyHtml,
      "Réinitialiser le mot de passe",
      resetLink,
    );

    const text = `${greeting}\n\nVous avez demandé la réinitialisation de votre mot de passe.\n\nRéinitialiser le mot de passe : ${resetLink}\n\n${siteName}`;

    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port || 587,
      secure: smtp.use_tls && smtp.port === 465,
      auth: { user: smtp.username, pass: smtp.password },
      tls: smtp.use_tls ? { rejectUnauthorized: false } : undefined,
    });

    await transporter.sendMail({
      from: smtp.from_name ? `${smtp.from_name} <${smtp.from_email}>` : smtp.from_email,
      to: targetAuthUser.email,
      subject: `Réinitialisation de votre mot de passe — ${siteName}`,
      text,
      html,
    });

    console.log(`Password reset email sent to ${targetAuthUser.email} for org ${orgId}`);

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("send-password-reset error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
