import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";
import { useCourierSla } from "@/hooks/useCourierSla";
import { splitAppliedTags } from "@/lib/courier-tags";
import { listTicketsForCourier } from "@/services/actionTicketService";
import { getAnalysis } from "@/services/courierAnalysisService";
import { getDocuments } from "@/services/courierDocumentService";
import { listRelationsForCourier } from "@/services/courierRelationService";
import { getCourierSlaFacts } from "@/services/courierService";
import { listTags } from "@/services/courierTagService";

export interface EluParticipant {
  id: string;
  role: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  socle_contact_id: string | null;
}

function participantName(p: {
  name: string | null;
  first_name: string | null;
  last_name: string | null;
}): string | null {
  return p.name?.trim() || [p.first_name, p.last_name].filter(Boolean).join(" ").trim() || null;
}

/**
 * Le courrier reçu, en lecture seule, avec TOUT ce que montre le poste de
 * travail : identité, service instructeur, analyse, classement, délais,
 * contenu, pièces, actions liées, courriers liés, participants.
 *
 * Les clés de cache sont celles de l'application complète partout où la donnée
 * est la même (`courier-analysis`, `courier-documents`, `courier-tags`,
 * `action-tickets`, `courier-relations`) : un élu qui repasse en affichage
 * complet ne recharge rien, et une mise à jour d'un côté se voit de l'autre.
 */
export function useEluCourrier(courierId: string | undefined) {
  const { organizationId } = useOrganization();

  const { data: courier, isLoading } = useQuery({
    queryKey: ["elu-courrier", organizationId, courierId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("couriers")
        .select(
          "id, subject, chrono, received_at, created_at, channel, direction, assigned_service, socle_organization_id, metadata, workflow_state:workflow_states(name, category), courier_participants(id, role, name, first_name, last_name, email, phone, socle_contact_id)",
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

  const { data: orgTags = [] } = useQuery({
    queryKey: ["courier-tags", organizationId],
    queryFn: () => listTags(organizationId!),
    enabled: !!organizationId,
  });

  const { data: tickets = [] } = useQuery({
    queryKey: ["action-tickets", courierId],
    queryFn: () => listTicketsForCourier(courierId!),
    enabled: !!courierId,
  });

  const { data: relations = [] } = useQuery({
    queryKey: ["courier-relations", courierId],
    queryFn: () => listRelationsForCourier(courierId!),
    enabled: !!courierId,
  });

  const { data: slaFacts } = useQuery({
    queryKey: ["elu-courrier-sla", organizationId, courierId],
    queryFn: () => getCourierSlaFacts(organizationId!, courierId!),
    enabled: !!organizationId && !!courierId,
  });
  const slaOf = useCourierSla(organizationId);
  const sla = slaFacts
    ? slaOf({ ...slaFacts, socle_organization_id: courier?.socle_organization_id ?? null })
    : null;
  const hasSla = !!sla && (sla.ack.kind !== "none" || sla.resolution.kind !== "none");

  const rawParticipants = courier?.courier_participants ?? [];
  const participants: EluParticipant[] = rawParticipants.map((p) => ({
    id: p.id,
    role: p.role,
    name: participantName(p),
    email: p.email ?? null,
    phone: p.phone ?? null,
    socle_contact_id: p.socle_contact_id ?? null,
  }));
  const sender = participants.find((p) => p.role === "sender") ?? null;
  const recipient = participants.find((p) => p.role === "recipient") ?? null;

  const state = (Array.isArray(courier?.workflow_state)
    ? courier?.workflow_state[0]
    : courier?.workflow_state) as { name: string; category: string } | null | undefined;

  const metadata = (courier?.metadata ?? {}) as Record<string, unknown>;
  const appliedTags = (metadata.tags as string[] | undefined) ?? [];
  const bodyText = typeof metadata.body_text === "string" ? metadata.body_text.trim() : "";

  return {
    courier,
    isLoading,
    senderName: sender?.name ?? null,
    senderEmail: sender?.email ?? null,
    senderPhone: sender?.phone ?? null,
    senderContactId: sender?.socle_contact_id ?? null,
    recipientName: recipient?.name ?? null,
    participants,
    stateName: state?.name ?? null,
    serviceName: courier?.assigned_service ?? null,
    summary: analysis?.summary ?? null,
    suggestedActions: analysis?.suggested_actions ?? [],
    tagsByGroup: splitAppliedTags(appliedTags, orgTags),
    tagCount: appliedTags.length,
    bodyText: bodyText || null,
    documents,
    tickets,
    relations,
    sla: hasSla ? sla : null,
  };
}
