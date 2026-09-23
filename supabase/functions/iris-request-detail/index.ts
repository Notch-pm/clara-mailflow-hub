// Fil d'UNE demande Iris — lecture seule, pour la page « détail de la demande »
// du poste de travail et de l'espace élu (docs/iris-integration.md §5 ter).
//
// Body : { organization_id, iris_request_id }. Accès et périmètre :
// `_shared/iris-reader.ts`. Une demande hors des organisations de l'appelant
// répond 404, comme une demande inexistante : on ne révèle pas son existence.
//
// Les NOTES INTERNES d'Iris transitent par ici. Elles ne sont servies qu'à un
// membre connecté du tenant, dans son périmètre, et rien n'est stocké.

import { irisErrorMessage } from "../_shared/iris-envelope.ts";
import { getIrisRequestTimeline, resolveIrisIntegration } from "../_shared/iris.ts";
import { buildDemandeDetail, lookupMap } from "../_shared/iris-contact-requests.ts";
import { corsHeaders, jsonResponse as json, loadLabels, resolveIrisReader, UUID_RE } from "../_shared/iris-reader.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { organization_id: organizationId, iris_request_id: requestId } =
      (await req.json().catch(() => ({}))) as { organization_id?: string; iris_request_id?: string };
    if (!organizationId || !UUID_RE.test(organizationId)) {
      return json({ error: "organization_id invalide (uuid attendu)" }, 400);
    }
    if (!requestId || !UUID_RE.test(requestId)) {
      return json({ error: "iris_request_id invalide (uuid attendu)" }, 400);
    }

    const reader = await resolveIrisReader(req, organizationId);
    if (reader instanceof Response) return reader;
    const { supabaseAdmin, allowedSocleOrgIds } = reader;

    const { integration, reason } = await resolveIrisIntegration(supabaseAdmin, organizationId);
    if (!integration) return json({ skipped: true, reason });

    const { status, body } = await getIrisRequestTimeline(integration, requestId);
    if (status === 404) return json({ error: "Demande introuvable" }, 404);
    if (status !== 200) {
      console.warn(`[iris] fil de la demande : HTTP ${status}`);
      return json({ error: irisErrorMessage(status, body) }, 502);
    }

    const request = body?.request;
    const [labels, ticket] = await Promise.all([
      loadLabels(
        supabaseAdmin,
        organizationId,
        request?.socle_procedure_id ? [request.socle_procedure_id] : [],
        request?.socle_organization_id ? [request.socle_organization_id] : [],
      ),
      supabaseAdmin
        .from("action_tickets")
        .select("courier_id")
        .eq("organization_id", organizationId)
        .eq("iris_request_id", requestId)
        .limit(1)
        .maybeSingle(),
    ]);
    if (ticket.error) throw ticket.error;

    const detail = buildDemandeDetail(
      body,
      {
        procedures: lookupMap(labels.procedures),
        organizations: lookupMap(labels.organizations),
        couriersByIrisRequest: ticket.data?.courier_id
          ? new Map([[requestId, ticket.data.courier_id as string]])
          : new Map(),
      },
      allowedSocleOrgIds,
    );
    if (!detail) return json({ error: "Demande introuvable" }, 404);
    return json(detail);
  } catch (error) {
    console.error("[iris] iris-request-detail:", error);
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
