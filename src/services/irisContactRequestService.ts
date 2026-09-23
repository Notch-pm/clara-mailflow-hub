import { supabase } from "@/integrations/supabase/client";
import { edgeError } from "@/lib/edge-error";
import type { ContactDemande, DemandeDetail } from "../../supabase/functions/_shared/iris-contact-requests";

export type { ContactDemande };

/**
 * Demandes Iris d'un usager, lues en direct via `iris-contact-requests` (rien
 * n'est stocké dans Clara). `null` : ce tenant n'est pas raccordé à Iris — ce
 * n'est pas une erreur, l'écran n'affiche simplement pas la section.
 */
export async function listContactIrisRequests(
  organizationId: string,
  socleContactId: string,
): Promise<ContactDemande[] | null> {
  const { data, error } = await supabase.functions.invoke("iris-contact-requests", {
    body: { organization_id: organizationId, socle_contact_id: socleContactId },
  });
  if (error) throw await edgeError(error, "Demandes Iris indisponibles");
  const payload = data as { skipped?: boolean; demandes?: ContactDemande[] };
  if (payload?.skipped) return null;
  return payload?.demandes ?? [];
}

export type { DemandeDetail };

/**
 * Fil d'une demande Iris (texte, activité, commentaires internes,
 * interventions), via `iris-request-detail`. `null` : tenant non raccordé.
 * Une demande hors du périmètre de l'appelant échoue en 404, comme une
 * demande inexistante.
 */
export async function getIrisRequestDetail(
  organizationId: string,
  irisRequestId: string,
): Promise<DemandeDetail | null> {
  const { data, error } = await supabase.functions.invoke("iris-request-detail", {
    body: { organization_id: organizationId, iris_request_id: irisRequestId },
  });
  if (error) throw await edgeError(error, "Demande indisponible");
  const payload = data as (DemandeDetail & { skipped?: boolean }) | null;
  if (!payload || payload.skipped) return null;
  return payload;
}
