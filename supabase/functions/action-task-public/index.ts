// Edge function: action-task-public (PUBLIQUE, verify_jwt=false)
// POST { action: "get",      token }          → contenu minimal de la tâche
// POST { action: "complete", token, note? }   → la marque terminée (idempotent)
//
// Appelée par la page /tache/:token, ouverte depuis le mail envoyé par
// `action-task-mail`. L'autorisation EST le jeton : 32 octets aléatoires,
// stockés hachés (SHA-256) dans `action_task_tokens`, révoqués dès que la tâche
// est terminée (trigger `action_tickets_task_status`). Tout passe en POST : le
// lien du mail ouvre une page, jamais un endpoint qui modifie — un scanner de
// liens de messagerie ne peut donc rien clore.
// Contenu MINIMAL : ni objet du courrier, ni usager, ni pièces.
import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { hashTaskToken, isWellFormedTaskToken, normalizeCompletionNote } from "../_shared/actionTask.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-client-info, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const NOT_FOUND = "Ce lien n'est pas valide, ou la tâche a été supprimée.";

const fullName = (u: { first_name?: string | null; last_name?: string | null } | null) =>
  [u?.first_name, u?.last_name].filter(Boolean).join(" ").trim() || null;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Méthode non autorisée" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const { action, token, note } = body as { action?: string; token?: unknown; note?: unknown };
    if (action !== "get" && action !== "complete") return json({ error: "Action inconnue" }, 400);
    if (!isWellFormedTaskToken(token)) return json({ error: NOT_FOUND }, 404);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    const { data: tokenRow } = await admin
      .from("action_task_tokens")
      .select("ticket_id, revoked_at")
      .eq("token_hash", await hashTaskToken(token))
      .maybeSingle();
    if (!tokenRow) return json({ error: NOT_FOUND }, 404);

    const loadTicket = async () =>
      (
        await admin
          .from("action_tickets")
          .select(
            "id, kind, status, organization_id, courier_id, title, description, assignee_id, assignee_name, created_by, completed_at, completed_via, completion_note",
          )
          .eq("id", tokenRow.ticket_id)
          .maybeSingle()
      ).data;

    let ticket = await loadTicket();
    if (!ticket || ticket.kind !== "tache") return json({ error: NOT_FOUND }, 404);

    // Un jeton révoqué sur une tâche ROUVERTE ne vaut plus : la relance en a
    // envoyé un neuf. Sur une tâche terminée, il sert encore à afficher l'état.
    if (tokenRow.revoked_at && ticket.status !== "done") return json({ error: NOT_FOUND }, 404);

    if (action === "complete" && ticket.status !== "done") {
      const completionNote = normalizeCompletionNote(note);
      const { error: updError } = await admin
        .from("action_tickets")
        .update({
          status: "done",
          completed_at: new Date().toISOString(),
          completed_by: null,
          completed_via: "lien",
          completion_note: completionNote,
        })
        .eq("id", ticket.id)
        .eq("status", "open");
      if (updError) throw updError;

      await admin.from("courier_events").insert({
        organization_id: ticket.organization_id,
        courier_id: ticket.courier_id,
        event_type: "task_completed",
        payload: {
          ticket_id: ticket.id,
          title: ticket.title,
          via: "lien",
          assignee_name: ticket.assignee_name,
          note: completionNote,
        },
        created_by: null,
      });

      // Prévenir l'auteur de la tâche (s'il est encore membre actif).
      if (ticket.created_by) {
        const { data: membership } = await admin
          .from("organization_users")
          .select("id")
          .eq("user_id", ticket.created_by)
          .eq("organization_id", ticket.organization_id)
          .eq("is_active", true)
          .maybeSingle();
        if (membership) {
          await admin.from("notifications").insert({
            organization_id: ticket.organization_id,
            user_id: ticket.created_by,
            type: "task_completed",
            title: `Tâche terminée : ${ticket.title ?? "Tâche"}`,
            resource_id: ticket.courier_id,
          });
        }
      }

      ticket = (await loadTicket()) ?? ticket;
    }

    const [{ data: courier }, { data: org }, { data: author }, { data: assigneeMember }] =
      await Promise.all([
        admin.from("couriers").select("chrono").eq("id", ticket.courier_id).maybeSingle(),
        admin
          .from("organizations")
          .select("name, primary_color, logo_url")
          .eq("id", ticket.organization_id)
          .maybeSingle(),
        ticket.created_by
          ? admin.from("users").select("first_name, last_name").eq("id", ticket.created_by).maybeSingle()
          : Promise.resolve({ data: null }),
        ticket.assignee_id
          ? admin
              .from("organization_users")
              .select("id")
              .eq("user_id", ticket.assignee_id)
              .eq("organization_id", ticket.organization_id)
              .eq("is_active", true)
              .maybeSingle()
          : Promise.resolve({ data: null }),
      ]);

    return json({
      task: {
        title: ticket.title,
        description: ticket.description,
        status: ticket.status,
        completed_at: ticket.completed_at,
        completed_via: ticket.completed_via,
        completion_note: ticket.completion_note,
        assignee_name: ticket.assignee_name,
        author_name: fullName(author),
        courier_chrono: courier?.chrono ?? null,
        // Lien « Ouvrir dans Clara » : seulement pour un affecté membre actif.
        courier_id: assigneeMember ? ticket.courier_id : null,
      },
      organization: {
        name: org?.name ?? null,
        primary_color: org?.primary_color ?? null,
        logo_url: org?.logo_url ?? null,
      },
    });
  } catch (err) {
    console.error("action-task-public error:", err);
    return json({ error: "Une erreur est survenue. Réessayez plus tard." }, 500);
  }
});
