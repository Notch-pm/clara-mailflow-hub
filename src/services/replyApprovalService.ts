import { supabase } from "@/integrations/supabase/client";
import { getReplyWorkflow, signReply, transitionReplyState } from "@/services/courierReplyService";
import { getSignatureDataUrl } from "@/services/signatoryService";
import { grantVisa } from "@/services/courierVisaService";
import { listOrgsWithConfig } from "@/services/socleOrgConfigService";
import { appendSignature, buildSignatureBlock } from "@/lib/reply-signature";
import type { WorkflowState } from "@/types/courier";

// Viser et signer une réponse, puis l'avancer d'une étape. Un seul chemin pour
// l'espace élu (`useSignAndAdvance`) et le parapheur, y compris en lot : deux
// écrans qui signeraient chacun à leur façon finiraient par produire deux
// courriers différents pour la même réponse. Les gardes restent au serveur
// (trigger `courier_visas_validate`, `couriers_enforce_visa`).

/** L'état d'arrivée d'une transition, tel que `transitionReplyState` l'attend. */
export interface ApprovalTarget {
  id: string;
  name: string;
  category: string | null;
}

export interface ApprovalSignatory {
  id: string;
  first_name: string;
  last_name: string;
  title: string | null;
  user_id: string | null;
  signature_storage_key: string | null;
}

interface ReplyRef {
  organizationId: string;
  parentCourierId: string;
  replyId: string;
}

async function advance(ref: ReplyRef, target: ApprovalTarget): Promise<void> {
  await transitionReplyState(ref.organizationId, ref.parentCourierId, ref.replyId, target.id, target.name, target.category);
}

/**
 * Vise l'étape courante puis suit la transition nominale. Sans transition
 * suivante, le visa est tout de même consigné et la réponse reste dans l'étape.
 */
export async function visaAndAdvance(
  ref: ReplyRef & { stateId: string; next: ApprovalTarget | null; comment?: string | null },
): Promise<void> {
  await grantVisa({
    organizationId: ref.organizationId,
    parentCourierId: ref.parentCourierId,
    replyId: ref.replyId,
    stateId: ref.stateId,
    comment: ref.comment ?? null,
  });
  if (ref.next) await advance(ref, ref.next);
}

/** Appose la signature manuscrite du signataire, puis suit la transition nominale. */
export async function signAndAdvance(
  ref: ReplyRef & {
    stateId: string | null;
    bodyHtml: string;
    signatory: ApprovalSignatory;
    next: ApprovalTarget;
  },
): Promise<void> {
  const signatureDataUrl = await getSignatureDataUrl(ref.signatory.signature_storage_key!);
  const fullName = `${ref.signatory.first_name} ${ref.signatory.last_name}`.trim();
  const signedBody = appendSignature(
    ref.bodyHtml,
    buildSignatureBlock({ fullName, title: ref.signatory.title, signatureDataUrl }),
  );
  await signReply(ref.organizationId, ref.parentCourierId, ref.replyId, {
    bodyHtml: signedBody,
    signedBy: ref.signatory.id,
    signedStateId: ref.stateId,
  });
  await advance(ref, ref.next);
}

/** Pourquoi `userId` ne peut pas signer avec cette fiche (null : il le peut). */
export function signatureBlocker(signatory: ApprovalSignatory | null, userId: string | null): string | null {
  if (!signatory) return "Aucun signataire n'est désigné sur cette réponse.";
  if (signatory.user_id !== userId) return "Vous n'êtes pas le signataire désigné.";
  if (!signatory.signature_storage_key) return "Aucune signature manuscrite n'est enregistrée pour vous.";
  return null;
}

/**
 * Le contexte d'action d'une réponse, chargé hors React : c'est ce dont le
 * traitement en lot a besoin pour chaque réponse cochée — l'écran de détail,
 * lui, l'obtient par `useEluReply`.
 */
export async function loadApprovalContext(organizationId: string, replyId: string) {
  const { data: reply, error } = await supabase
    .from("couriers")
    .select("id, parent_courier_id, workflow_state_id, metadata, assigned_service, socle_organization_id")
    .eq("id", replyId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw error;
  if (!reply?.parent_courier_id) throw new Error("Réponse introuvable.");

  // Même résolution de l'organisation gestionnaire que `useEluReply`.
  const services = await listOrgsWithConfig(organizationId);
  const service =
    (reply.socle_organization_id && services.find((o) => o.id === reply.socle_organization_id)) ||
    (reply.assigned_service &&
      services.find((o) => o.name.toLowerCase() === reply.assigned_service!.toLowerCase())) ||
    null;
  if (!service?.reply_workflow_id) throw new Error("Aucun workflow de réponse n'est configuré.");

  const workflow = await getReplyWorkflow(service.reply_workflow_id);
  const state = (workflow.states.find((s) => s.id === reply.workflow_state_id) ?? null) as WorkflowState | null;
  const nextTransition = state
    ? workflow.transitions.find(
        (t) => t.from_state_id === state.id && (t as { kind?: string | null }).kind === "next",
      )
    : undefined;
  const nextState = nextTransition ? workflow.states.find((s) => s.id === nextTransition.to_state_id) : undefined;

  const metadata = (reply.metadata ?? {}) as Record<string, unknown>;
  const signatoryId = (metadata.signatory_id as string | undefined) ?? null;
  let signatory: ApprovalSignatory | null = null;
  if (signatoryId) {
    const { data, error: sErr } = await supabase
      .from("signatories")
      .select("id, first_name, last_name, title, user_id, signature_storage_key")
      .eq("id", signatoryId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (sErr) throw sErr;
    signatory = (data as ApprovalSignatory | null) ?? null;
  }

  return {
    ref: { organizationId, parentCourierId: reply.parent_courier_id, replyId },
    state,
    next: nextState ? { id: nextState.id, name: nextState.name, category: nextState.category ?? null } : null,
    bodyHtml: (metadata.body_html as string | undefined) ?? "",
    isSigned: !!metadata.signed_at,
    signatory,
  };
}
