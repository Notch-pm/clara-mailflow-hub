import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { to, organization_id } = await req.json();
    if (!to || !organization_id) {
      return new Response(JSON.stringify({ error: "Missing 'to' or 'organization_id'" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: smtp, error } = await supabase
      .from("smtp_settings")
      .select("*")
      .eq("organization_id", organization_id)
      .single();

    if (error || !smtp) {
      return new Response(JSON.stringify({ error: "Configuration SMTP introuvable" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: org } = await supabase
      .from("organizations")
      .select("name")
      .eq("id", organization_id)
      .single();

    const siteName = org?.name || "Clara";

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
      subject: `E-mail de test — ${siteName}`,
      text: `Ceci est un e-mail de test envoyé depuis ${siteName}. Si vous recevez ce message, la configuration SMTP fonctionne correctement.`,
      html: `<div style="font-family:Arial,sans-serif;padding:20px;">
        <h2 style="color:#18181b;">E-mail de test</h2>
        <p>Ceci est un e-mail de test envoyé depuis <strong>${siteName}</strong>.</p>
        <p>Si vous recevez ce message, la configuration SMTP fonctionne correctement.</p>
      </div>`,
    });

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("send-test-email error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
