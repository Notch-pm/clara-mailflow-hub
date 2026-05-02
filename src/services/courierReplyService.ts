import { supabase } from "@/integrations/supabase/client";
import { logEvent } from "./courierEventService";
import type { CourierChannel, WorkflowState, WorkflowTransition } from "@/types/courier";

export interface ReplyRecord {
  id: string;
  parent_courier_id: string | null;
  organization_id: string;
  channel: CourierChannel;
  subject: string | null;
  workflow_state_id: string | null;
  metadata: Record<string, unknown> | null;
  assigned_service: string | null;
}

export interface ReplyWorkflowData {
  workflowId: string;
  states: WorkflowState[];
  transitions: WorkflowTransition[];
  initialState: WorkflowState | null;
}

/**
 * Returns the (single) outbound child courier acting as reply for the given parent.
 */
export async function getReplyForCourier(
  organizationId: string,
  parentCourierId: string,
): Promise<ReplyRecord | null> {
  const { data, error } = await supabase
    .from("couriers")
    .select("id, parent_courier_id, organization_id, channel, subject, workflow_state_id, metadata, assigned_service")
    .eq("organization_id", organizationId)
    .eq("parent_courier_id", parentCourierId)
    .eq("direction", "outbound")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as ReplyRecord | null) ?? null;
}

/**
 * Loads the reply workflow (states + transitions + initial state) for a given workflow id.
 */
export async function getReplyWorkflow(replyWorkflowId: string): Promise<ReplyWorkflowData> {
  const [{ data: states, error: sErr }, { data: transitions, error: tErr }] = await Promise.all([
    supabase.from("workflow_states").select("*").eq("workflow_id", replyWorkflowId).order("created_at", { ascending: true }),
    supabase.from("workflow_transitions").select("*").eq("workflow_id", replyWorkflowId).order("created_at", { ascending: true }),
  ]);
  if (sErr) throw sErr;
  if (tErr) throw tErr;
  const stateList = (states ?? []) as WorkflowState[];
  return {
    workflowId: replyWorkflowId,
    states: stateList,
    transitions: (transitions ?? []) as WorkflowTransition[],
    initialState: stateList.find((s) => s.is_initial) ?? stateList[0] ?? null,
  };
}

interface CreateReplyArgs {
  organizationId: string;
  parentCourierId: string;
  channel: CourierChannel;
  bodyHtml: string;
  parentSubject: string | null;
  assignedService: string | null;
  initialStateId: string | null;
  recipient?: { name?: string | null; email?: string | null; first_name?: string | null; last_name?: string | null } | null;
}

export async function createReply(args: CreateReplyArgs): Promise<ReplyRecord> {
  const subject = args.parentSubject
    ? args.parentSubject.toLowerCase().startsWith("re:")
      ? args.parentSubject
      : `Re: ${args.parentSubject}`
    : "Réponse";

  const { data, error } = await supabase
    .from("couriers")
    .insert({
      organization_id: args.organizationId,
      parent_courier_id: args.parentCourierId,
      direction: "outbound",
      channel: args.channel,
      subject,
      assigned_service: args.assignedService,
      workflow_state_id: args.initialStateId,
      // sent_at is required by the check_dates constraint on outbound couriers.
      // For drafts we use the creation timestamp as a placeholder; it gets
      // refreshed when the reply transitions to a final/processed state.
      sent_at: new Date().toISOString(),
      metadata: { body_html: args.bodyHtml, body_text: stripHtml(args.bodyHtml), is_draft: true },
    } as never)
    .select("id, parent_courier_id, organization_id, channel, subject, workflow_state_id, metadata, assigned_service")
    .single();
  if (error) throw error;

  const reply = data as unknown as ReplyRecord;

  // Link recipient (the original sender)
  if (args.recipient && (args.recipient.email || args.recipient.name || args.recipient.last_name)) {
    await supabase.from("courier_participants").insert({
      organization_id: args.organizationId,
      courier_id: reply.id,
      role: "recipient",
      name: args.recipient.name ?? null,
      first_name: args.recipient.first_name ?? null,
      last_name: args.recipient.last_name ?? null,
      email: args.recipient.email ?? null,
    } as never);
  }

  await logEvent(args.organizationId, args.parentCourierId, "reply_created", {
    reply_id: reply.id,
    channel: args.channel,
  });

  return reply;
}

export async function updateReplyContent(
  organizationId: string,
  replyId: string,
  patch: {
    channel?: CourierChannel;
    bodyHtml?: string;
    signatoryId?: string | null;
    signedAt?: string | null;
    signedBy?: string | null;
    signedStateId?: string | null;
  },
): Promise<void> {
  // Fetch current metadata to preserve other keys
  const { data: existing, error: fErr } = await supabase
    .from("couriers")
    .select("metadata")
    .eq("id", replyId)
    .single();
  if (fErr) throw fErr;
  const currentMeta = ((existing as { metadata: Record<string, unknown> | null } | null)?.metadata) ?? {};

  const update: Record<string, unknown> = {};
  if (patch.channel) update.channel = patch.channel;

  const nextMeta: Record<string, unknown> = { ...currentMeta };
  let metaChanged = false;
  if (typeof patch.bodyHtml === "string") {
    nextMeta.body_html = patch.bodyHtml;
    nextMeta.body_text = stripHtml(patch.bodyHtml);
    metaChanged = true;
  }
  if (patch.signatoryId !== undefined) {
    nextMeta.signatory_id = patch.signatoryId;
    metaChanged = true;
  }
  if (patch.signedAt !== undefined) {
    nextMeta.signed_at = patch.signedAt;
    metaChanged = true;
  }
  if (patch.signedBy !== undefined) {
    nextMeta.signed_by = patch.signedBy;
    metaChanged = true;
  }
  if (patch.signedStateId !== undefined) {
    nextMeta.signed_state_id = patch.signedStateId;
    metaChanged = true;
  }
  if (metaChanged) update.metadata = nextMeta;

  if (Object.keys(update).length === 0) return;

  const { error } = await supabase
    .from("couriers")
    .update(update as never)
    .eq("id", replyId)
    .eq("organization_id", organizationId);
  if (error) throw error;
}

export async function transitionReplyState(
  organizationId: string,
  parentCourierId: string,
  replyId: string,
  toStateId: string,
  toStateName: string | null,
  toStateCategory: string | null,
): Promise<void> {
  const { error } = await supabase
    .from("couriers")
    .update({ workflow_state_id: toStateId } as never)
    .eq("id", replyId)
    .eq("organization_id", organizationId);
  if (error) throw error;

  await logEvent(organizationId, parentCourierId, "reply_state_changed", {
    reply_id: replyId,
    to_state_id: toStateId,
    to_state_name: toStateName,
  });

  if (toStateCategory === "processed") {
    const { data: replyRow } = await supabase
      .from("couriers")
      .select("sent_at")
      .eq("id", replyId)
      .maybeSingle();
    if (!(replyRow as { sent_at: string | null } | null)?.sent_at) {
      await supabase
        .from("couriers")
        .update({ sent_at: new Date().toISOString() } as never)
        .eq("id", replyId);
    }
    await logEvent(organizationId, parentCourierId, "reply_sent", { reply_id: replyId });
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<\/(p|div|br|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+\n/g, "\n")
    .trim();
}

export async function signReply(
  organizationId: string,
  parentCourierId: string,
  replyId: string,
  args: { bodyHtml: string; signedBy: string; signedStateId?: string | null },
): Promise<void> {
  await updateReplyContent(organizationId, replyId, {
    bodyHtml: args.bodyHtml,
    signedAt: new Date().toISOString(),
    signedBy: args.signedBy,
    signedStateId: args.signedStateId ?? null,
  });
  await logEvent(organizationId, parentCourierId, "reply_signed", {
    reply_id: replyId,
    signed_by: args.signedBy,
    signed_state_id: args.signedStateId ?? null,
  });
}

export async function unsignReply(
  organizationId: string,
  parentCourierId: string,
  replyId: string,
  args: { bodyHtml: string },
): Promise<void> {
  await updateReplyContent(organizationId, replyId, {
    bodyHtml: args.bodyHtml,
    signedAt: null,
    signedBy: null,
    signedStateId: null,
  });
  await logEvent(organizationId, parentCourierId, "reply_unsigned", {
    reply_id: replyId,
  });
}

/**
 * Removes the signature block from an HTML body.
 * Supports both the legacy <div data-signature-block="true"> wrapper and
 * the current marker (an <img alt="signature-clara">). For the current
 * marker, we strip from the last preceding <hr> through the end of the doc.
 */
export function stripSignatureBlock(html: string): string {
  // Legacy wrapper
  let out = html.replace(
    /<div[^>]*data-signature-block="true"[\s\S]*?<\/div>/gi,
    "",
  );
  // Current marker: find <img ... alt="signature-clara" ...>
  const imgIdx = out.search(/<img[^>]*alt=["']signature-clara["'][^>]*>/i);
  if (imgIdx !== -1) {
    // Find the last <hr ...> before the marker; strip from there to end.
    const before = out.slice(0, imgIdx);
    const hrMatches = [...before.matchAll(/<hr\b[^>]*\/?>/gi)];
    if (hrMatches.length > 0) {
      const lastHr = hrMatches[hrMatches.length - 1];
      out = out.slice(0, lastHr.index);
    } else {
      // No hr found — fall back to stripping from the paragraph wrapping the img
      const pStart = out.lastIndexOf("<p", imgIdx);
      out = pStart !== -1 ? out.slice(0, pStart) : out.slice(0, imgIdx);
    }
  }
  return out.trimEnd();
}
