import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";
import { getAnalysis } from "@/services/courierAnalysisService";
import { getDocuments } from "@/services/courierDocumentService";

/**
 * Le courrier reçu, en lecture seule, tel qu'un élu a besoin de le lire avant
 * de signer la réponse : de qui, quand, ce qu'il demande.
 */
export function useEluCourrier(courierId: string | undefined) {
  const { organizationId } = useOrganization();

  const { data: courier, isLoading } = useQuery({
    queryKey: ["elu-courrier", organizationId, courierId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("couriers")
        .select(
          "id, subject, chrono, received_at, created_at, channel, direction, assigned_service, " +
            "workflow_state:workflow_states(name, category), " +
            "courier_participants(role, name, first_name, last_name, email, socle_contact_id)",
        )
        .eq("id", courierId!)
        .eq("organization_id", organizationId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!organizationId && !!courierId,
  });

  // Le résumé produit par le guichet IA : c'est lui qui donne à l'élu la
  // substance du courrier sans lui faire ouvrir les pièces jointes.
  const { data: analysis } = useQuery({
    queryKey: ["courier-analysis", courierId],
    queryFn: () => getAnalysis(courierId!),
    enabled: !!courierId,
  });

  const { data: documents = [] } = useQuery({
    queryKey: ["courier-documents", courierId],
    queryFn: () => getDocuments(courierId!),
    enabled: !!courierId,
  });

  const participants = courier?.courier_participants ?? [];
  const sender = participants.find((p) => p.role === "sender") ?? null;
  const senderName =
    sender?.name?.trim() ||
    [sender?.first_name, sender?.last_name].filter(Boolean).join(" ").trim() ||
    null;

  const state = (Array.isArray(courier?.workflow_state)
    ? courier?.workflow_state[0]
    : courier?.workflow_state) as { name: string; category: string } | null | undefined;

  return {
    courier,
    isLoading,
    senderName,
    senderEmail: sender?.email ?? null,
    senderContactId: sender?.socle_contact_id ?? null,
    stateName: state?.name ?? null,
    summary: analysis?.summary ?? null,
    intents: analysis?.intents ?? [],
    documents,
  };
}
