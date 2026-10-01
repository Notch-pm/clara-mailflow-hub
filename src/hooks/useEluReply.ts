import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";
import {
  getReplyWorkflow,
  listRepliesForCourier,
  splitSignatureBlock,
  type ReplyRecord,
} from "@/services/courierReplyService";
import { listOrgsWithConfig } from "@/services/socleOrgConfigService";
import { activeVisaFor, listOrgViseurs, listReplyVisas } from "@/services/courierVisaService";
import type { WorkflowState, WorkflowTransition } from "@/types/courier";

export interface EluTransitionChoice {
  transitionId: string;
  label: string;
  kind: "next" | "previous" | null;
  target: {
    id: string;
    name: string;
    category: string | null;
    is_final: boolean | null;
    is_initial: boolean | null;
  };
}

/** Une transition sortante, telle que l'écran de détail doit la proposer. */
function toChoice(
  transition: WorkflowTransition,
  target: WorkflowState,
): EluTransitionChoice {
  return {
    transitionId: transition.id,
    // Le libellé de la transition prime : c'est le mot choisi par la
    // collectivité (« Renvoyer au service »), pas le nom de l'état d'arrivée.
    label: transition.name || target.name,
    kind: ((transition as { kind?: string | null }).kind ?? null) as "next" | "previous" | null,
    target: {
      id: target.id,
      name: target.name,
      category: target.category ?? null,
      is_final: target.is_final ?? null,
      is_initial: target.is_initial ?? null,
    },
  };
}

/**
 * Tout ce que l'écran de détail d'une réponse a besoin de savoir.
 *
 * Les clés de cache sont celles de l'application complète partout où la donnée
 * est la même (`courier-replies`, `reply-workflow`, `socle-orgs-config`) : un
 * élu qui repasse en affichage complet ne recharge rien.
 */
export function useEluReply(replyId: string | undefined) {
  const { organizationId } = useOrganization();

  const { data: reply, isLoading: replyLoading } = useQuery({
    queryKey: ["elu-reply", organizationId, replyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("couriers")
        .select(
          "id, parent_courier_id, organization_id, channel, subject, workflow_state_id, metadata, assigned_service, socle_organization_id, created_at, courier_participants(role, name, first_name, last_name, email, socle_contact_id)",
        )
        .eq("id", replyId!)
        .eq("organization_id", organizationId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!organizationId && !!replyId,
  });

  const parentId = reply?.parent_courier_id ?? null;

  const { data: parent } = useQuery({
    queryKey: ["elu-reply-parent", organizationId, parentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("couriers")
        .select(
          "id, subject, chrono, received_at, courier_participants(role, name, first_name, last_name, socle_contact_id)",
        )
        .eq("id", parentId!)
        .eq("organization_id", organizationId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!organizationId && !!parentId,
  });

  // Rang de la réponse (« Réponse n°2 ») : même clé que l'écran complet.
  const { data: siblings } = useQuery({
    queryKey: ["courier-replies", parentId],
    queryFn: () => listRepliesForCourier(organizationId!, parentId!),
    enabled: !!organizationId && !!parentId,
  });

  const { data: services } = useQuery({
    queryKey: ["socle-orgs-config", organizationId],
    queryFn: () => listOrgsWithConfig(organizationId!),
    enabled: !!organizationId,
  });

  const service = useMemo(() => {
    if (!services || !reply) return null;
    if (reply.socle_organization_id) {
      const byId = services.find((o) => o.id === reply.socle_organization_id);
      if (byId) return byId;
    }
    if (!reply.assigned_service) return null;
    return services.find((o) => o.name.toLowerCase() === reply.assigned_service!.toLowerCase()) ?? null;
  }, [services, reply]);

  const replyWorkflowId = service?.reply_workflow_id ?? null;

  const { data: workflow } = useQuery({
    queryKey: ["reply-workflow", replyWorkflowId],
    queryFn: () => getReplyWorkflow(replyWorkflowId!),
    enabled: !!replyWorkflowId,
  });

  const { data: signatories = [] } = useQuery({
    queryKey: ["socle-org-signatories-detailed", service?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("socle_organization_signatories")
        .select("signatory:signatories(id, first_name, last_name, title, user_id, signature_storage_key)")
        .eq("socle_organization_id", service!.id);
      if (error) throw error;
      return (data ?? [])
        .map((r) => (Array.isArray(r.signatory) ? r.signatory[0] : r.signatory))
        .filter(Boolean) as Array<{
        id: string;
        first_name: string;
        last_name: string;
        title: string | null;
        user_id: string | null;
        signature_storage_key: string | null;
      }>;
    },
    enabled: !!service?.id,
  });

  const currentState = useMemo(
    () => workflow?.states.find((s) => s.id === reply?.workflow_state_id) ?? null,
    [workflow, reply],
  );

  // Visa : mêmes clés que le composeur et l'écran du courrier sortant, que
  // toute transition invalide (`reply-visas`) — un retour en rédaction périme
  // le visa, l'écran doit le relire.
  const { data: visas = [] } = useQuery({
    queryKey: ["reply-visas", organizationId, [replyId], reply?.workflow_state_id ?? null],
    queryFn: () => listReplyVisas(organizationId!, [replyId!]),
    enabled: !!organizationId && !!replyId,
  });

  const isVisaState = currentState?.requires_visa === true;

  const { data: viseurs = [] } = useQuery({
    queryKey: ["socle-org-viseurs-detailed", organizationId, service?.id],
    queryFn: () => listOrgViseurs(organizationId!, service!.id),
    enabled: !!organizationId && !!service?.id && isVisaState,
  });

  const outgoing = useMemo<EluTransitionChoice[]>(() => {
    if (!workflow || !currentState) return [];
    return workflow.transitions
      .filter((t) => t.from_state_id === currentState.id)
      .map((t) => {
        const target = workflow.states.find((s) => s.id === t.to_state_id);
        return target ? toChoice(t, target) : null;
      })
      .filter(Boolean) as EluTransitionChoice[];
  }, [workflow, currentState]);

  const metadata = (reply?.metadata ?? {}) as Record<string, unknown>;
  const bodyHtml = (metadata.body_html as string | undefined) ?? "";

  // Le corps s'affiche SANS le bloc de signature : l'élu relit ce que le
  // service a rédigé, la signature n'est apposée qu'au moment de signer.
  const readableBody = useMemo(() => splitSignatureBlock(bodyHtml).content, [bodyHtml]);

  const rank = useMemo(() => {
    if (!siblings || !replyId) return null;
    const index = siblings.findIndex((r: ReplyRecord) => r.id === replyId);
    return index >= 0 ? index + 1 : null;
  }, [siblings, replyId]);

  const parentSender = (parent?.courier_participants ?? []).find((p) => p.role === "sender");
  const senderName =
    parentSender?.name?.trim() ||
    [parentSender?.first_name, parentSender?.last_name].filter(Boolean).join(" ").trim() ||
    null;

  const visaDesignees = (metadata.visa_viseurs ?? {}) as Record<string, string>;
  const designatedViseurId = currentState ? visaDesignees[currentState.id] ?? null : null;

  return {
    reply,
    parent,
    parentId,
    bodyHtml,
    readableBody,
    rank,
    chrono: parent?.chrono ?? null,
    serviceName: service?.name ?? reply?.assigned_service ?? null,
    senderName,
    senderContactId: parentSender?.socle_contact_id ?? null,
    workflow,
    currentState,
    outgoing,
    signatories,
    signatoryId: (metadata.signatory_id as string | undefined) ?? null,
    isSigned: !!metadata.signed_at,
    isSent: !!metadata.sent_email_at,
    channel: reply?.channel ?? "paper",
    visas,
    isVisaState,
    activeVisa: replyId ? activeVisaFor(visas, replyId, currentState?.id) : null,
    viseurs,
    designatedViseur: viseurs.find((v) => v.id === designatedViseurId) ?? null,
    designatedViseurId,
    isLoading: replyLoading,
    /** Ni organisation gestionnaire, ni workflow de réponse : rien à proposer. */
    isUnconfigured: !!reply && !replyWorkflowId,
  };
}
