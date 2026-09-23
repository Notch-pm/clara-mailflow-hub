// Demandes Iris d'UN usager — lecture seule, pour la fiche contact et l'espace
// élu (docs/iris-integration.md §5 ter).
//
// Body : { organization_id, socle_contact_id }. Accès et périmètre :
// `_shared/iris-reader.ts` (membre actif ; hors administrateur, seules les
// organisations Socle de l'appelant — appliqué ici, pas seulement à l'écran).
//
// Iris répond selon la clé : avec `requests:read_tenant`, toutes les sources ;
// sans, seulement les demandes déposées par Clara. Dans les deux cas c'est une
// réponse valide — la vue est partielle, pas en panne.

import { irisErrorMessage } from "../_shared/iris-envelope.ts";
import { listIrisRequestsByContact, resolveIrisIntegration } from "../_shared/iris.ts";
import { buildContactDemandes, lookupMap } from "../_shared/iris-contact-requests.ts";
import { corsHeaders, jsonResponse as json, loadLabels, resolveIrisReader, UUID_RE } from "../_shared/iris-reader.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { organization_id: organizationId, socle_contact_id: contactId } =
      (await req.json().catch(() => ({}))) as { organization_id?: string; socle_contact_id?: string };
    if (!organizationId || !UUID_RE.test(organizationId)) {
      return json({ error: "organization_id invalide (uuid attendu)" }, 400);
    }
    if (!contactId || !UUID_RE.test(contactId)) {
      return json({ error: "socle_contact_id invalide (uuid attendu)" }, 400);
    }

    const reader = await resolveIrisReader(req, organizationId);
    if (reader instanceof Response) return reader;
    const { supabaseAdmin, allowedSocleOrgIds } = reader;

    // Suspendue comprise : la suspension coupe le dépôt, pas la lecture.
    const { integration, reason } = await resolveIrisIntegration(supabaseAdmin, organizationId);
    if (!integration) return json({ skipped: true, reason });

    const { status, body } = await listIrisRequestsByContact(integration, contactId);
    if (status !== 200) {
      console.warn(`[iris] demandes de l'usager : HTTP ${status}`);
      return json({ error: irisErrorMessage(status, body) }, 502);
    }
    const requests = Array.isArray(body?.requests) ? body.requests : [];
    if (requests.length === 0) return json({ demandes: [] });

    // Libellés et lien vers le courrier d'origine, lus dans les miroirs.
    const procedureIds = [...new Set(requests.map((r) => r.socle_procedure_id).filter((v): v is string => !!v))];
    const orgIds = [...new Set(requests.map((r) => r.socle_organization_id).filter((v): v is string => !!v))];
    const requestIds = requests.map((r) => r.id).filter((v): v is string => !!v);

    const [labels, tickets] = await Promise.all([
      loadLabels(supabaseAdmin, organizationId, procedureIds, orgIds),
      supabaseAdmin
        .from("action_tickets")
        .select("iris_request_id, courier_id")
        .eq("organization_id", organizationId)
        .in("iris_request_id", requestIds),
    ]);
    if (tickets.error) throw tickets.error;

    const demandes = buildContactDemandes(
      requests,
      {
        procedures: lookupMap(labels.procedures),
        organizations: lookupMap(labels.organizations),
        couriersByIrisRequest: new Map(
          (tickets.data ?? [])
            .filter((t) => t.iris_request_id && t.courier_id)
            .map((t) => [t.iris_request_id as string, t.courier_id as string]),
        ),
      },
      allowedSocleOrgIds,
    );

    return json({ demandes });
  } catch (error) {
    console.error("[iris] iris-contact-requests:", error);
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
