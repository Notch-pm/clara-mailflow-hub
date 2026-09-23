import { supabase } from "@/integrations/supabase/client";
import { edgeError } from "@/lib/edge-error";
import type { ContactDemande } from "../../supabase/functions/_shared/iris-contact-requests";

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
