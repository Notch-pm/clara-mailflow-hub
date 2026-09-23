import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-org-id, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

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
    : `<h2 style="margin:0;color:#18181b;font-size:20px;font-weight:700;">${siteName}</h2>`;

  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background-color:#ffffff;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#ffffff;padding:40px 20px;">
<tr><td align="center">
<table role="presentation" width="520" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border:1px solid ${primary};border-radius:12px;overflow:hidden;">
<tr><td style="background-color:#ffffff;border-bottom:1px solid ${primary};padding:24px 32px;text-align:center;">${logoHtml}</td></tr>
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
    if (!authHeader) return json({ error: "Non autorisé" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: callerUser }, error: authError } = await callerClient.auth.getUser();
    if (authError || !callerUser) return json({ error: "Non autorisé" }, 401);

    const body = await req.json().catch(() => ({}));
    // `unassigned_user_id` bascule en mode retrait : le ticket étant relu après
    // l'update, l'ancien titulaire n'y figure plus et doit être nommé.
    const { ticket_id, unassigned_user_id } = body as {
      ticket_id?: string;
      unassigned_user_id?: string;
    };
    if (!ticket_id) return json({ error: "Paramètres invalides" }, 400);
    const isRemoval = !!unassigned_user_id;

    const admin = createClient(supabaseUrl, serviceRoleKey);

    // Le ticket est relu côté serveur : le client ne choisit pas le destinataire.
    const { data: ticket } = await admin
      .from("action_tickets")
      .select("id, courier_id, organization_id, title, assignee_id, procedure:procedures(name)")
      .eq("id", ticket_id)
      .single();
    if (!ticket) return json({ error: "Ticket introuvable" }, 404);

    // Le demandeur doit appartenir à l'organisation du ticket.
    const { data: callerMembership } = await admin
      .from("organization_users")
      .select("id")
      .eq("user_id", callerUser.id)
      .eq("organization_id", ticket.organization_id)
      .maybeSingle();
    if (!callerMembership) return json({ error: "Accès refusé" }, 403);

    // En retrait, le destinataire est nommé par l'appelant : on exige que le
    // ticket ne lui soit effectivement plus affecté, pour qu'un client ne
    // puisse pas fabriquer un faux retrait sur une affectation en cours.
    if (isRemoval && ticket.assignee_id === unassigned_user_id) {
      return json({ success: true, notified: false, reason: "still_assigned" });
    }

    const recipientId = isRemoval ? unassigned_user_id! : ticket.assignee_id;
    if (!recipientId) return json({ success: true, notified: false, reason: "no_recipient" });

    // Agir sur sa propre affectation ne déclenche aucune notification.
    if (recipientId === callerUser.id) {
      return json({ success: true, notified: false, reason: "self_action" });
    }

    // Le destinataire doit être un membre actif de la même organisation.
    const { data: targetMembership } = await admin
      .from("organization_users")
      .select("id")
      .eq("user_id", recipientId)
      .eq("organization_id", ticket.organization_id)
      .eq("is_active", true)
      .maybeSingle();
    if (!targetMembership) return json({ success: true, notified: false, reason: "not_a_member" });

    const [{ data: courier }, { data: assignee }, { data: caller }, { data: org }] = await Promise.all([
      admin.from("couriers").select("id, subject").eq("id", ticket.courier_id).single(),
      admin.from("users").select("id, email, first_name, last_name").eq("id", recipientId).single(),
      admin.from("users").select("first_name, last_name, email").eq("id", callerUser.id).single(),
      admin
        .from("organizations")
        .select("name, primary_color, secondary_color, logo_url")
        .eq("id", ticket.organization_id)
        .single(),
    ]);

    const procedureName = (ticket.procedure as { name?: string } | null)?.name ?? null;
    const actionLabel = ticket.title?.trim() || procedureName || "Action";
    const subjectLine = courier?.subject || "(sans objet)";
    const siteName = org?.name || "Clara";
    const authorName =
      [caller?.first_name, caller?.last_name].filter(Boolean).join(" ").trim() ||
      caller?.email ||
      "Un utilisateur";

    // In-app d'abord : elle ne doit pas dépendre de la disponibilité du SMTP.
    const { error: notifError } = await admin.from("notifications").insert({
      organization_id: ticket.organization_id,
      user_id: recipientId,
      type: isRemoval ? "action_unassigned" : "action_assigned",
      title: isRemoval
        ? `Affectation retirée : ${actionLabel}`
        : `Action affectée : ${actionLabel}`,
      resource_id: ticket.courier_id,
    });
    if (notifError) console.error("send-assignment-notification notif error:", notifError);

    const origin =
      Deno.env.get("APP_ORIGIN") ||
      req.headers.get("origin") ||
      supabaseUrl.replace(".supabase.co", ".lovableproject.com");
    // Permalien vers le courrier, onglet « Actions liées ».
    const link = `${origin}/courrier/${ticket.courier_id}?tab=actions`;

    const { data: smtp } = await admin
      .from("smtp_settings")
      .select("*")
      .eq("organization_id", ticket.organization_id)
      .single();

    // Pas de miroir du serveur d'envoi (il vient du référentiel) ou pas
    // d'adresse : la notification in-app a déjà été posée, on n'échoue pas pour
    // autant — seul le mail est sauté.
    if (!smtp?.host || !assignee?.email) {
      return json({ success: true, notified: true, mailed: false, reason: "no_smtp_or_email" });
    }

    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port || 587,
      secure: smtp.use_tls && smtp.port === 465,
      auth: { user: smtp.username, pass: smtp.password },
      tls: smtp.use_tls ? { rejectUnauthorized: false } : undefined,
    });

    const greetingName = [assignee.first_name, assignee.last_name].filter(Boolean).join(" ").trim();
    const greeting = greetingName ? `Bonjour ${greetingName},` : "Bonjour,";
    const sentence = isRemoval
      ? `<strong>${escapeHtml(authorName)}</strong> vous a retiré l'action <strong>${escapeHtml(actionLabel)}</strong> sur le courrier <strong>${escapeHtml(subjectLine)}</strong>.`
      : `<strong>${escapeHtml(authorName)}</strong> vous a affecté l'action <strong>${escapeHtml(actionLabel)}</strong> sur le courrier <strong>${escapeHtml(subjectLine)}</strong>.`;
    const bodyHtml = `<p style="margin:0 0 8px;font-size:14px;line-height:1.6;color:#52525b;">${escapeHtml(greeting)}</p>
        <p style="margin:0 0 28px;font-size:14px;line-height:1.6;color:#52525b;">${sentence}</p>`;
    const html = buildBrandedEmail(
      {
        name: siteName,
        primary_color: org?.primary_color || null,
        secondary_color: org?.secondary_color || null,
        logo_url: org?.logo_url || null,
      },
      isRemoval ? "Une affectation vous a été retirée" : "Une action vous a été affectée",
      bodyHtml,
      isRemoval ? "Voir le courrier" : "Voir l'action",
      link,
    );
    const plainSentence = isRemoval
      ? `${authorName} vous a retiré l'action « ${actionLabel} » sur le courrier « ${subjectLine} ».`
      : `${authorName} vous a affecté l'action « ${actionLabel} » sur le courrier « ${subjectLine} ».`;
    const text = `${greeting}\n\n${plainSentence}\n\n${isRemoval ? "Voir le courrier" : "Voir l'action"} : ${link}\n\n${siteName}`;

    let mailed = false;
    try {
      await transporter.sendMail({
        from: smtp.from_name ? `${smtp.from_name} <${smtp.from_email}>` : smtp.from_email,
        to: assignee.email,
        subject: isRemoval
          ? `Affectation retirée — ${subjectLine}`
          : `Action affectée — ${subjectLine}`,
        text,
        html,
      });
      mailed = true;
    } catch (e) {
      console.error("send-assignment-notification mail error:", assignee.email, e);
    }

    return json({ success: true, notified: true, mailed });
  } catch (err) {
    console.error("send-assignment-notification error:", err);
    return json({ error: (err as Error).message }, 500);
  }
});
