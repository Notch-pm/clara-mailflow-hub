import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { to, organization_id } = await req.json();
    if (!to || !organization_id) {
      return new Response(
        JSON.stringify({ error: "Paramètres manquants (to, organization_id)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(
        JSON.stringify({ error: "Configuration serveur manquante" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data: smtp, error } = await supabase
      .from("smtp_settings")
      .select("*")
      .eq("organization_id", organization_id)
      .single();

    if (error || !smtp) {
      return new Response(
        JSON.stringify({ error: "Configuration SMTP introuvable" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: org } = await supabase
      .from("organizations")
      .select("name, primary_color, logo_url")
      .eq("id", organization_id)
      .single();

    const siteName = org?.name || "Clara";
    const primary = org?.primary_color || "#18181b";

    const logoHtml = org?.logo_url
      ? `<img src="${org.logo_url}" alt="${siteName}" style="max-height:48px;max-width:200px;" />`
      : `<h2 style="margin:0;color:#ffffff;font-size:20px;font-weight:700;">${siteName}</h2>`;

    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port || 587,
      secure: smtp.use_tls && smtp.port === 465,
      auth: {
        user: smtp.username,
        pass: smtp.password,
      },
      tls: smtp.use_tls ? { rejectUnauthorized: false } : undefined,
    });

    await transporter.sendMail({
      from: smtp.from_name
        ? `${smtp.from_name} <${smtp.from_email}>`
        : smtp.from_email,
      to,
      subject: `✅ Test SMTP — ${siteName}`,
      text: `Ceci est un e-mail de test envoyé depuis ${siteName}.\n\nVotre configuration SMTP fonctionne correctement.`,
      html: `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:40px 20px;">
    <tr><td align="center">
      <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <tr><td style="background-color:${primary};padding:24px 32px;text-align:center;">
          ${logoHtml}
        </td></tr>
        <tr><td style="padding:32px;">
          <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#18181b;">✅ Test SMTP réussi</h1>
          <p style="margin:0 0 8px;font-size:14px;line-height:1.6;color:#52525b;">Ceci est un e-mail de test envoyé depuis <strong>${siteName}</strong>.</p>
          <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#52525b;">Votre configuration SMTP fonctionne correctement.</p>
          <hr style="border:none;border-top:1px solid #e4e4e7;margin:20px 0;" />
          <p style="margin:0;font-size:12px;color:#a1a1aa;">
            Serveur : ${smtp.host}:${smtp.port} — TLS : ${smtp.use_tls ? "Oui" : "Non"}
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
    });

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Send test email error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
