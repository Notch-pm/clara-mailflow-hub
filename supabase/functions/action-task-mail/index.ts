// Edge function: action-task-mail
// POST { ticket_id, mode: "notify" | "remind" } (JWT agent)
//
// Envoie à l'agent affecté d'une tâche (action interne) le mail qui porte le
// lien « Marquer comme terminée » (/tache/<jeton>, sans connexion). Chaque envoi
// crée son propre jeton ; seul son hash est stocké (`action_task_tokens`).
// Contenu MINIMAL : intitulé, commentaire, référence (chrono) du courrier,
// collectivité, auteur — jamais l'objet, l'usager ni les pièces : le lien
// circule par mail. Un affecté utilisateur de Clara reçoit en plus une
// notification in-app et un lien « Ouvrir dans Clara ».
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6";
import { escapeHtml, hexOr, renderBrandedEmail } from "../_shared/emailLayout.ts";
import { generateTaskToken, hashTaskToken, taskMailSubject } from "../_shared/actionTask.ts";

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

const P = (html: string, margin = "0 0 12px") =>
  `<p style="margin:${margin};font-size:14px;line-height:1.6;color:#52525b;">${html}</p>`;

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
    const { ticket_id, mode } = body as { ticket_id?: string; mode?: string };
    if (!ticket_id || (mode !== "notify" && mode !== "remind")) {
      return json({ error: "Paramètres invalides" }, 400);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);

    // Le ticket est relu côté serveur : le client ne choisit ni le destinataire
    // ni le contenu.
    const { data: ticket } = await admin
      .from("action_tickets")
      .select(
        "id, kind, status, courier_id, organization_id, title, description, assignee_id, assignee_email, assignee_name, created_by, reminder_count",
      )
      .eq("id", ticket_id)
      .maybeSingle();
    if (!ticket || ticket.kind !== "tache") return json({ error: "Tâche introuvable" }, 404);
    if (ticket.status !== "open") return json({ error: "Cette tâche est déjà terminée." }, 409);

    // Écrire (créer, relancer) est réservé aux éditeurs de l'organisation.
    const { data: canEdit } = await callerClient.rpc("is_editor_of", {
      _org: ticket.organization_id,
    });
    if (!canEdit) return json({ error: "Accès refusé" }, 403);

    const [{ data: courier }, { data: author }, { data: org }, { data: smtp }] = await Promise.all([
      admin.from("couriers").select("id, chrono").eq("id", ticket.courier_id).single(),
      admin
        .from("users")
        .select("first_name, last_name, email")
        .eq("id", ticket.created_by ?? callerUser.id)
        .maybeSingle(),
      admin
        .from("organizations")
        .select("name, primary_color, logo_url")
        .eq("id", ticket.organization_id)
        .single(),
      admin.from("smtp_settings").select("*").eq("organization_id", ticket.organization_id).maybeSingle(),
    ]);

    // L'affecté est-il (toujours) un membre actif ? Lui seul a droit au lien
    // Clara et à la notification in-app.
    let isMember = false;
    if (ticket.assignee_id) {
      const { data: membership } = await admin
        .from("organization_users")
        .select("id")
        .eq("user_id", ticket.assignee_id)
        .eq("organization_id", ticket.organization_id)
        .eq("is_active", true)
        .maybeSingle();
      isMember = !!membership;
    }

    const isRemind = mode === "remind";
    const title = ticket.title?.trim() || "Tâche";
    const siteName = org?.name || "Clara";
    const chrono = courier?.chrono || null;
    const authorName =
      [author?.first_name, author?.last_name].filter(Boolean).join(" ").trim() ||
      author?.email ||
      "Un agent";

    // Une relance n'est comptée que si elle a atteint l'affecté (mail ou in-app).
    const countReminder = async () => {
      if (!isRemind) return;
      await admin
        .from("action_tickets")
        .update({
          last_reminded_at: new Date().toISOString(),
          reminder_count: (ticket.reminder_count ?? 0) + 1,
        })
        .eq("id", ticket.id);
    };

    // In-app d'abord : elle ne dépend pas du SMTP. Pas de notification à soi-même.
    let notified = false;
    if (isMember && ticket.assignee_id !== callerUser.id) {
      const { error: notifError } = await admin.from("notifications").insert({
        organization_id: ticket.organization_id,
        user_id: ticket.assignee_id,
        type: isRemind ? "task_reminded" : "task_assigned",
        title: isRemind ? `Relance : ${title}` : `Tâche affectée : ${title}`,
        resource_id: ticket.courier_id,
      });
      if (notifError) console.error("action-task-mail notif error:", notifError);
      notified = !notifError;
    }

    // Pas de miroir du serveur d'envoi : on n'échoue pas, l'écran avertit.
    if (!smtp?.host || !ticket.assignee_email) {
      if (notified) await countReminder();
      return json({ success: true, mailed: false, notified, reason: "no_smtp_or_email" });
    }

    const token = generateTaskToken();
    const { error: tokenError } = await admin.from("action_task_tokens").insert({
      ticket_id: ticket.id,
      organization_id: ticket.organization_id,
      token_hash: await hashTaskToken(token),
    });
    if (tokenError) throw tokenError;

    const origin = (Deno.env.get("APP_ORIGIN") || "https://clara.edilumen.fr").replace(/\/+$/, "");
    const taskLink = `${origin}/tache/${token}`;
    const claraLink = isMember ? `${origin}/courrier/${ticket.courier_id}?tab=actions` : null;

    const greeting = ticket.assignee_name?.trim() ? `Bonjour ${ticket.assignee_name.trim()},` : "Bonjour,";
    const intro = isRemind
      ? `<strong>${escapeHtml(authorName)}</strong> vous relance au sujet de la tâche suivante, qui vous a été confiée :`
      : `<strong>${escapeHtml(authorName)}</strong> vous a confié la tâche suivante :`;
    const lines = [
      P(escapeHtml(greeting), "0 0 8px"),
      P(intro),
      P(`<strong>${escapeHtml(title)}</strong>`),
      ticket.description?.trim()
        ? P(escapeHtml(ticket.description.trim()).replace(/\n/g, "<br>"))
        : "",
      P(
        `Courrier ${chrono ? `<strong>${escapeHtml(chrono)}</strong>` : ""} — ${escapeHtml(siteName)}`,
      ),
      P(
        "Une fois la tâche réalisée, indiquez-le en un clic avec le bouton ci-dessous (aucune connexion nécessaire).",
        "0 0 28px",
      ),
      claraLink
        ? P(`Vous pouvez aussi <a href="${claraLink}" style="color:#2563eb;">ouvrir le courrier dans Clara</a>.`, "0 0 20px")
        : "",
    ];
    const html = renderBrandedEmail({
      primary: hexOr(org?.primary_color, "#0acf83"),
      siteName,
      logoUrl: org?.logo_url,
      heading: isRemind ? "Relance : une tâche vous attend" : "Une tâche vous a été confiée",
      bodyHtml: lines.join("\n"),
      action: { label: "Marquer comme terminée", url: taskLink },
    });
    const text = [
      greeting,
      "",
      isRemind
        ? `${authorName} vous relance au sujet de la tâche suivante :`
        : `${authorName} vous a confié la tâche suivante :`,
      `« ${title} »`,
      ticket.description?.trim() ?? "",
      `Courrier ${chrono ?? ""} — ${siteName}`,
      "",
      `Marquer comme terminée : ${taskLink}`,
      claraLink ? `Ouvrir dans Clara : ${claraLink}` : "",
      "",
      siteName,
    ].join("\n");

    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port || 587,
      secure: smtp.use_tls && smtp.port === 465,
      auth: { user: smtp.username, pass: smtp.password },
      tls: smtp.use_tls ? { rejectUnauthorized: false } : undefined,
    });

    let mailed = false;
    try {
      await transporter.sendMail({
        from: smtp.from_name ? `${smtp.from_name} <${smtp.from_email}>` : smtp.from_email,
        to: ticket.assignee_email,
        subject: taskMailSubject(isRemind ? "remind" : "notify", title),
        text,
        html,
      });
      mailed = true;
    } catch (e) {
      console.error("action-task-mail send error:", ticket.assignee_email, e);
    }

    if (mailed || notified) await countReminder();
    return json({ success: true, mailed, notified });
  } catch (err) {
    console.error("action-task-mail error:", err);
    return json({ error: (err as Error).message }, 500);
  }
});
