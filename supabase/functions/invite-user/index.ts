import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import nodemailer from "npm:nodemailer@6";

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

function buildBrandedEmail(org: OrgBranding, heading: string, bodyHtml: string, ctaLabel: string, ctaUrl: string) {
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
    return new Response("ok", { headers: corsHeaders });
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
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseCaller = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user: callerUser } } = await supabaseCaller.auth.getUser();
    if (!callerUser) {
      return new Response(JSON.stringify({ error: "Non autorisé" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: callerProfile } = await supabaseAdmin
      .from("users")
      .select("is_superadmin")
      .eq("id", callerUser.id)
      .single();

    const isSuperAdmin = callerProfile?.is_superadmin === true;

    const body = await req.json();
    const { email, first_name, last_name, role, organization_id } = body;

    if (!email || !first_name || !last_name || !role || !organization_id) {
      return new Response(JSON.stringify({ error: "Champs obligatoires manquants" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!isSuperAdmin) {
      const { data: callerMembership } = await supabaseAdmin
        .from("organization_users")
        .select("role")
        .eq("user_id", callerUser.id)
        .eq("organization_id", organization_id)
        .single();

      if (!callerMembership || callerMembership.role !== "administrateur") {
        return new Response(JSON.stringify({ error: "Vous devez être administrateur de cette organisation" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Check if auth user already exists
    const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
    const existingAuthUser = existingUsers?.users?.find(
      (u) => u.email?.toLowerCase() === email.toLowerCase()
    );

    let authUserId: string;
    let isNewUser = false;

    if (existingAuthUser) {
      authUserId = existingAuthUser.id;

      const { data: existingLink } = await supabaseAdmin
        .from("organization_users")
        .select("id")
        .eq("organization_id", organization_id)
        .eq("user_id", authUserId)
        .maybeSingle();

      if (existingLink) {
        return new Response(JSON.stringify({ error: "Cet utilisateur est déjà membre de cette organisation." }), {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else {
      // Create auth user (without sending Supabase's default email)
      const { data: createData, error: createError } =
        await supabaseAdmin.auth.admin.createUser({
          email,
          email_confirm: false,
          user_metadata: { first_name, last_name },
        });

      if (createError) {
        console.error("Create user error:", createError);
        return new Response(JSON.stringify({ error: createError.message }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      authUserId = createData.user.id;
      isNewUser = true;
    }

    // Upsert public.users record
    const { error: upsertError } = await supabaseAdmin.from("users").upsert(
      { id: authUserId, email: email.toLowerCase(), first_name, last_name, is_active: true },
      { onConflict: "id" }
    );

    if (upsertError) {
      console.error("Users upsert error:", upsertError);
      return new Response(JSON.stringify({ error: upsertError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create organization_users link
    const { error: linkError } = await supabaseAdmin
      .from("organization_users")
      .insert({ organization_id, user_id: authUserId, role, is_active: true });

    if (linkError) {
      console.error("Link error:", linkError);
      return new Response(JSON.stringify({ error: linkError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Send branded invitation email via org SMTP if new user
    if (isNewUser) {
      try {
        // Generate invite link
        const { data: linkData, error: linkError } =
          await supabaseAdmin.auth.admin.generateLink({
            type: "invite",
            email,
            options: {
              redirectTo: `${(req.headers.get("origin") || "").replace(/\/$/, "")}/activer-compte`,
            },
          });

        if (linkError || !linkData?.properties?.hashed_token) {
          console.error("Generate link error:", linkError);
          throw new Error(linkError?.message || "Impossible de générer le lien d'invitation");
        }

        const tokenHash = linkData.properties.hashed_token;
        const redirectTo = `${(req.headers.get("origin") || "").replace(/\/$/, "")}/activer-compte`;
        const confirmationUrl = `${supabaseUrl}/auth/v1/verify?token=${tokenHash}&type=invite&redirect_to=${encodeURIComponent(redirectTo)}`;

        // Fetch org branding
        const { data: org } = await supabaseAdmin
          .from("organizations")
          .select("name, primary_color, secondary_color, logo_url")
          .eq("id", organization_id)
          .single();

        const orgBranding: OrgBranding = {
          name: org?.name || "Clara",
          primary_color: (org as any)?.primary_color || null,
          secondary_color: (org as any)?.secondary_color || null,
          logo_url: (org as any)?.logo_url || null,
        };

        // Fetch SMTP settings
        const { data: smtp, error: smtpError } = await supabaseAdmin
          .from("smtp_settings")
          .select("*")
          .eq("organization_id", organization_id)
          .single();

        if (smtpError || !smtp) {
          console.error(`No SMTP settings for org ${organization_id}`);
          throw new Error("Configuration SMTP introuvable pour cette organisation");
        }

        const siteName = orgBranding.name;
        const subject = `Activez votre compte — ${siteName}`;
        const heading = "Bienvenue !";
        const bodyText = `Vous avez été invité(e) à rejoindre <strong>${siteName}</strong>. Cliquez sur le bouton ci-dessous pour définir votre mot de passe et activer votre compte.`;
        const bodyHtml = `<p style="margin:0 0 28px;font-size:14px;line-height:1.6;color:#52525b;">${bodyText}</p>`;
        const ctaLabel = "Activer mon compte";

        const html = buildBrandedEmail(orgBranding, heading, bodyHtml, ctaLabel, confirmationUrl);
        const text = `${heading}\n\n${bodyText.replace(/<[^>]+>/g, "")}\n\n${ctaLabel} : ${confirmationUrl}\n\n${siteName}`;

        await sendViaSMTP(smtp as SmtpSettings, email, subject, html, text);
        console.log(`Branded invite email sent to ${email} for org ${organization_id}`);
      } catch (emailErr) {
        console.error("Failed to send invite email:", emailErr);
        // User is created, just email failed — don't fail the whole request
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        user_id: authUserId,
        message: isNewUser
          ? "Utilisateur créé et invitation envoyée"
          : "Utilisateur existant ajouté à l'organisation",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Unexpected error:", err);
    return new Response(JSON.stringify({ error: "Erreur interne du serveur" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
