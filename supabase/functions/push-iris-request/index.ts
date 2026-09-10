// Dépose dans Iris la demande portée par une action de courrier.
//
// Iris est propriétaire exclusif des demandes d'usagers : une action fondée sur
// une DÉMARCHE du référentiel y est déposée, puis instruite là-bas ; Clara n'en
// garde qu'un suivi. Une action sans démarche (« demande libre ») reste chez
// Clara — ce n'est pas un échec, c'est la frontière entre les deux produits.
//
// Body : { ticket_id }. Rien d'autre n'est accepté : l'enveloppe est
// INTÉGRALEMENT relue en base côté serveur. Un client ne choisit ni la
// démarche, ni l'organisation, ni le demandeur — il désigne un ticket, dont la
// création a déjà été gardée par la RLS.
//
// Le ticket existe AVANT l'appel (son id est l'`external_id` d'Iris) : un échec
// ici ne détruit rien, il se rejoue à l'identique grâce à
// `iris_idempotency_key` (rejeu au contenu identique → 200, cas nominal du
// contrat). C'est la différence assumée avec `create-arpege-demande`, qui crée
// chez le partenaire avant de créer le ticket.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { assertEditor } from "../_shared/authz.ts";
import {
  buildIrisEnvelope,
  irisErrorMessage,
  irisRequestFromBody,
  isIrisStatus,
} from "../_shared/iris-envelope.ts";
import { postIrisRequest, resolveIrisIntegration } from "../_shared/iris.ts";

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

    const { ticket_id } = (await req.json().catch(() => ({}))) as { ticket_id?: string };
    if (!ticket_id) return json({ error: "ticket_id requis" }, 400);

    // ── Le ticket, et tout ce qui compose la demande, relus côté serveur ──
    const { data: ticket, error: ticketErr } = await supabaseAdmin
      .from("action_tickets")
      .select("id, organization_id, courier_id, procedure_id, title, description, socle_data, socle_organization_id, iris_idempotency_key, iris_request_id")
      .eq("id", ticket_id)
      .maybeSingle();
    if (ticketErr) throw ticketErr;
    if (!ticket) return json({ error: "Action introuvable" }, 404);

    const organizationId = ticket.organization_id as string;

    const { data: membership } = await supabaseAdmin
      .from("organization_users")
      .select("user_id")
      .eq("user_id", user.id)
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .maybeSingle();
    if (!membership) return json({ error: "Accès refusé" }, 403);

    // Déposer une demande est un effet de bord : le consultant est en lecture seule.
    if (!(await assertEditor(supabaseAdmin, user.id, organizationId))) {
      return json({ error: "Accès refusé : rôle consultant en lecture seule" }, 403);
    }

    const lookup = await resolveIrisIntegration(supabaseAdmin, organizationId);
    // Déposer exige une interface ACTIVE : la suspension coupe le nouveau
    // trafic (le suivi, lui, continue — c'est l'affaire de sync-iris-requests).
    if (!lookup.integration || lookup.reason !== "ok") {
      // Pas d'interface du tout : cette collectivité ne dépose pas ses demandes
      // dans Iris. Ce n'est pas un incident, et l'agent n'a rien à réparer —
      // on ne salit ni le ticket ni son écran.
      if (lookup.reason === "absente") {
        return json({ skipped: true, reason: "absente" });
      }
      // Suspendue ou incomplète, en revanche, c'est un dépôt à refaire : on le
      // trace pour que le renvoi soit proposé.
      const message = lookup.reason === "suspendue"
        ? "Interface Iris suspendue pour cette organisation : la demande n'a pas été déposée."
        : "Interface Iris incomplète (adresse ou clé manquante) : la demande n'a pas été déposée.";
      await supabaseAdmin
        .from("action_tickets")
        .update({ iris_last_attempt_at: new Date().toISOString(), iris_last_error: message })
        .eq("id", ticket.id);
      return json({ error: message }, 400);
    }
    const integration = lookup.integration;

    const [{ data: courier }, { data: procedure }] = await Promise.all([
      supabaseAdmin
        .from("couriers")
        .select("id, chrono, subject, channel, received_at, socle_organization_id")
        .eq("id", ticket.courier_id)
        .maybeSingle(),
      ticket.procedure_id
        ? supabaseAdmin
          .from("procedures")
          .select("socle_id, name, obsoleted_at")
          .eq("id", ticket.procedure_id)
          .eq("organization_id", organizationId)
          .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    if (!courier) return json({ error: "Courrier introuvable" }, 404);

    // Organisme destinataire : celui que l'agent a CHOISI sur l'action, et à
    // défaut celui du courrier (actions créées avant que le choix n'existe).
    // Les deux colonnes pointent le MIROIR Clara ; Iris attend l'UUID Socle, on
    // traverse donc le miroir.
    const mirrorOrgId =
      (ticket.socle_organization_id as string | null) ??
      (courier.socle_organization_id as string | null);
    let socleOrganizationSocleId: string | null = null;
    if (mirrorOrgId) {
      const { data: mirror } = await supabaseAdmin
        .from("socle_organizations")
        .select("socle_id")
        .eq("id", mirrorOrgId)
        .maybeSingle();
      socleOrganizationSocleId = mirror?.socle_id ?? null;
    }

    // Garde AVANT le réseau : Iris refuse (trigger
    // `t18_requests_require_procedure_active`) une démarche que l'organisme
    // n'assure pas. Le miroir Clara connaît déjà la réponse — autant la donner
    // ici, où l'on sait nommer l'organisation et la démarche. Le miroir d'Iris
    // reste le dernier mot : il peut être plus ancien que celui de Clara, son
    // message est alors repris tel quel.
    if (ticket.procedure_id && mirrorOrgId) {
      const { data: offering } = await supabaseAdmin
        .from("procedure_organizations")
        .select("socle_organization_id")
        .eq("organization_id", organizationId)
        .eq("procedure_id", ticket.procedure_id)
        .is("obsoleted_at", null);
      const offeringIds = (offering ?? []).map(
        (r: { socle_organization_id: string }) => r.socle_organization_id,
      );
      // AUCUNE ligne = on ne conclut rien, exactement comme le dialogue :
      // démarche hors référentiel (Arpège, embryon local), ou miroir pas encore
      // peuplé. Refuser ici fermerait le dépôt pour tout le monde entre la
      // migration et la première synchronisation.
      if (offeringIds.length > 0 && !offeringIds.includes(mirrorOrgId)) {
        const { data: orgRow } = await supabaseAdmin
          .from("socle_organizations")
          .select("name")
          .eq("id", mirrorOrgId)
          .maybeSingle();
        const orgName = orgRow?.name ?? "cette organisation";
        const message =
          `« ${procedure?.name ?? "Cette démarche"} » n'est pas assurée par ${orgName} dans le référentiel : ` +
          `choisissez une autre organisation destinataire, ou faites-la activer dans le référentiel.`;
        await supabaseAdmin
          .from("action_tickets")
          .update({ iris_last_attempt_at: new Date().toISOString(), iris_last_error: message })
          .eq("id", ticket.id);
        return json({ error: message }, 400);
      }
    }

    // Usager rapproché : l'expéditeur du courrier, s'il porte une référence Socle.
    const { data: participants } = await supabaseAdmin
      .from("courier_participants")
      .select("role, socle_contact_id")
      .eq("courier_id", courier.id);
    const socleContactId =
      (participants ?? []).find((p: { role: string; socle_contact_id: string | null }) =>
        p.role === "sender" && p.socle_contact_id
      )?.socle_contact_id ?? null;

    const built = buildIrisEnvelope({
      ticket: {
        id: ticket.id as string,
        title: ticket.title as string | null,
        description: ticket.description as string | null,
        socle_data: ticket.socle_data,
        iris_idempotency_key: ticket.iris_idempotency_key as string,
      },
      courier: {
        id: courier.id as string,
        chrono: courier.chrono as string | null,
        subject: courier.subject as string | null,
        channel: courier.channel as string | null,
        received_at: courier.received_at as string | null,
        socle_organization_socle_id: socleOrganizationSocleId,
      },
      procedure: procedure as { socle_id?: string | null; name?: string | null; obsoleted_at?: string | null } | null,
      socleContactId,
      integration: { socle_root_org_id: integration.socle_root_org_id },
      appOrigin: Deno.env.get("APP_ORIGIN") ?? null,
    });

    if (!built.ok) {
      // Refus AVANT le réseau : on le trace comme un échec de dépôt, l'agent
      // sait quoi corriger et peut renvoyer.
      await supabaseAdmin
        .from("action_tickets")
        .update({ iris_last_attempt_at: new Date().toISOString(), iris_last_error: built.message })
        .eq("id", ticket.id);
      return json({ error: built.message }, 400);
    }

    const { status, body } = await postIrisRequest(integration, built.envelope);

    if (status !== 200 && status !== 201) {
      const message = irisErrorMessage(status, body);
      console.error(`[iris] dépôt refusé (ticket ${ticket.id}) : ${status}`);
      await supabaseAdmin
        .from("action_tickets")
        .update({ iris_last_attempt_at: new Date().toISOString(), iris_last_error: message })
        .eq("id", ticket.id);
      // 502 : l'échec vient d'Iris, pas de l'appelant — sauf 400/403, qui
      // disent quelque chose de la demande elle-même.
      return json({ error: message }, status === 400 || status === 403 ? 400 : 502);
    }

    // Iris enveloppe sa réponse : { created, request }.
    const demande = irisRequestFromBody(body);
    if (!demande) {
      const message = "Réponse illisible d'Iris : la demande a peut-être été créée, renvoyez pour vérifier.";
      await supabaseAdmin
        .from("action_tickets")
        .update({ iris_last_attempt_at: new Date().toISOString(), iris_last_error: message })
        .eq("id", ticket.id);
      return json({ error: message }, 502);
    }

    const update = {
      iris_request_id: demande.id ?? null,
      iris_reference: demande.reference ?? null,
      iris_status: isIrisStatus(demande.status) ? demande.status : null,
      iris_version: typeof demande.version === "number" ? demande.version : null,
      iris_url: demande.url ?? null,
      iris_synced_at: new Date().toISOString(),
      iris_last_attempt_at: new Date().toISOString(),
      iris_last_error: null,
    };
    const { error: updErr } = await supabaseAdmin
      .from("action_tickets")
      .update(update)
      .eq("id", ticket.id);
    if (updErr) throw updErr;

    console.log(
      `[iris] demande ${demande.reference ?? demande.id} déposée pour l'action ${ticket.id} (HTTP ${status})`,
    );

    return json({
      created: status === 201,
      request_id: update.iris_request_id,
      reference: update.iris_reference,
      status: update.iris_status,
      url: update.iris_url,
    });
  } catch (error) {
    console.error("[iris] push-iris-request:", error);
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
