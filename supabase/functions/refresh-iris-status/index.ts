// Rafraîchit l'état des demandes Iris d'UN courrier, à la demande.
//
// Pourquoi cette fonction existe : une fois déposée, la demande est instruite
// DANS Iris, et Clara n'en gardait que ce qu'elle avait écrit au dépôt jusqu'à
// la réconciliation nocturne (`sync-iris-requests`, 03:30). Une demande déposée
// à 12:44 et résolue à 12:53 s'affichait donc « À traiter » pendant quinze
// heures (incident fondateur : 2026-09-11). L'onglet « Actions liées » relit
// maintenant à chaque ouverture, comme il le fait déjà pour Arpège.
//
// Body : { courier_id }. Rien d'autre — l'organisation est relue en base depuis
// le courrier, jamais déclarée par le client.
//
// Deux différences assumées avec la réconciliation nocturne :
//   • elle lit `GET /v1/requests/{id}`, demande par demande (il y en a une
//     poignée par courrier), là où la nuit balaye `updated_since` pour tout le
//     tenant ;
//   • elle NE TOUCHE PAS au curseur `last_sync_at`. Ce curseur appartient au
//     balayage : l'avancer ici ferait sauter à la nuit suivante les demandes
//     des autres courriers modifiées entre-temps.
//
// L'écriture est une réconciliation SYSTÈME (service_role, idempotente) : tout
// membre actif peut la déclencher, consultant compris — voir un statut à jour
// n'est pas un effet de bord qui lui soit imputable.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  irisErrorMessage,
  irisRequestFromBody,
  irisTicketPatch,
} from "../_shared/iris-envelope.ts";
import { getIrisRequest, resolveIrisIntegration } from "../_shared/iris.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-org-id, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const json = (payload: unknown, status = 200) =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Non autorisé" }, 401);

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !user) return json({ error: "Non autorisé" }, 401);

    const { courier_id } = (await req.json().catch(() => ({}))) as { courier_id?: string };
    if (!courier_id) return json({ error: "courier_id requis" }, 400);

    const { data: courier, error: courierErr } = await supabaseAdmin
      .from("couriers")
      .select("id, organization_id")
      .eq("id", courier_id)
      .maybeSingle();
    if (courierErr) throw courierErr;
    if (!courier) return json({ error: "Courrier introuvable" }, 404);

    const organizationId = courier.organization_id as string;

    const { data: membership } = await supabaseAdmin
      .from("organization_users")
      .select("user_id")
      .eq("user_id", user.id)
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .maybeSingle();
    if (!membership) return json({ error: "Accès refusé" }, 403);

    // Demandes réellement déposées : sans `iris_request_id`, il n'y a rien à
    // relire (démarche Arpège, ticket d'avant la demande obligatoire, ou dépôt
    // jamais abouti — celui-là se règle par « Renvoyer », pas par une lecture).
    const { data: tickets, error: ticketsErr } = await supabaseAdmin
      .from("action_tickets")
      .select("id, iris_request_id")
      .eq("courier_id", courier_id)
      .eq("organization_id", organizationId)
      .not("iris_request_id", "is", null);
    if (ticketsErr) throw ticketsErr;
    if (!tickets || tickets.length === 0) return json({ examinees: 0, mises_a_jour: 0 });

    // Interface SUSPENDUE comprise : la suspension coupe le dépôt, pas le suivi
    // (docs/partenaires-integration.md §5). Absente = ce tenant ne dépose pas
    // dans Iris : rien à relire, et rien à signaler à l'agent.
    const { integration } = await resolveIrisIntegration(supabaseAdmin, organizationId);
    if (!integration) return json({ skipped: true, reason: "absente" });

    let misesAJour = 0;
    const avertissements: string[] = [];

    for (const ticket of tickets) {
      const requestId = ticket.iris_request_id as string;
      const { status, body } = await getIrisRequest(integration, requestId);

      if (status !== 200) {
        // Échec de LECTURE : on ne l'écrit pas sur le ticket. `iris_last_error`
        // ne parle que du dépôt — y ranger ceci proposerait « Renvoyer » pour
        // une demande qui existe déjà chez Iris.
        console.warn(`[iris] relecture ${requestId} : HTTP ${status}`);
        avertissements.push(irisErrorMessage(status, body));
        continue;
      }

      const demande = irisRequestFromBody(body);
      if (!demande) {
        avertissements.push("Réponse illisible d'Iris.");
        continue;
      }

      const version = typeof demande.version === "number" ? demande.version : null;
      // Même garde de version monotone que la nuit, et appliquée EN BASE : la
      // ligne n'est touchée que si la version reçue dépasse celle connue, sans
      // fenêtre entre le test et l'écriture.
      let query = supabaseAdmin
        .from("action_tickets")
        .update(irisTicketPatch(demande, new Date().toISOString()))
        .eq("id", ticket.id)
        .eq("organization_id", organizationId);
      if (version !== null) {
        query = query.or(`iris_version.is.null,iris_version.lt.${version}`);
      }
      const { data: updated, error } = await query.select("id");
      if (error) {
        avertissements.push(error.message);
        continue;
      }
      // Aucune ligne touchée = Clara sait déjà au moins autant qu'Iris
      // (`shouldApplyIrisUpdate` dit la même chose que le filtre ci-dessus) :
      // ce n'est pas un échec, il n'y a rien à compter.
      if (updated && updated.length > 0) misesAJour++;
    }

    return json({
      examinees: tickets.length,
      mises_a_jour: misesAJour,
      ...(avertissements.length > 0 ? { avertissements } : {}),
    });
  } catch (error) {
    console.error("[iris] refresh-iris-status:", error);
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
