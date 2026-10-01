import { supabase } from "@/integrations/supabase/client";
import { updateCourier } from "@/services/courierService";
import { logEvent } from "@/services/courierEventService";
import { assignOrganization, type SocleOrgWithConfig } from "@/services/socleOrgConfigService";
import { fetchMailroomMemberIds } from "@/services/mailroomService";

/**
 * Circulation d'un courrier entre le service courrier et les services
 * gestionnaires : routage (et routage en lot), transfert de service à service,
 * renvoi au service courrier, relance.
 *
 * Les événements écrits ici sont ceux que lit le RPC `mailroom_couriers` :
 * `service_changed` / `service_transferred` / `courier_routed` (routé),
 * `service_returned` (à réorienter), `service_reminded` (relance).
 */

type CourierRef = {
  id: string;
  subject?: string | null;
  assigned_service: string | null;
  socle_organization_id?: string | null;
  metadata: unknown;
};

/**
 * Notifie une liste d'utilisateurs, sauf l'auteur du geste (comme `new_courier`)
 * — non bloquant : l'action elle-même a réussi.
 */
async function notifyUsers(
  organizationId: string,
  userIds: string[],
  type: string,
  title: string,
  resourceId: string,
): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const recipients = [...new Set(userIds)].filter((id) => id !== user?.id);
  if (recipients.length === 0) return;
  const { error } = await supabase.from("notifications").insert(
    recipients.map((user_id) => ({ organization_id: organizationId, user_id, type, title, resource_id: resourceId })),
  );
  if (error) console.error(`Notifications « ${type} » non créées :`, error);
}

async function orgMemberIds(socleOrganizationId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("socle_organization_members")
    .select("user_id")
    .eq("socle_organization_id", socleOrganizationId);
  if (error) {
    console.error("Membres de l'organisation illisibles :", error);
    return [];
  }
  return ((data ?? []) as { user_id: string }[]).map((m) => m.user_id);
}

/** Journalise un événement de routage ; contrairement à `logEvent`, l'échec remonte. */
async function insertRoutingEvent(
  organizationId: string,
  courierId: string,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase.from("courier_events").insert({
    organization_id: organizationId,
    courier_id: courierId,
    event_type: eventType,
    payload: payload as never,
    created_by: user?.id ?? null,
  } as never);
  if (error) throw error;
}

function subjectOf(courier: CourierRef): string {
  return courier.subject?.trim() || "(sans objet)";
}

/**
 * Route un courrier vers une organisation depuis l'écran « Courrier entrant ».
 * - organisation différente (ou aucune) : affectation, état initial de son
 *   workflow (`assignOrganization`, qui journalise `service_changed`) ;
 * - organisation déjà posée (arrivée par une boîte IMAP rattachée) : rien ne
 *   bouge, seul `courier_routed` acte la décision du service courrier.
 * Les membres de l'organisation sont notifiés dans les deux cas.
 */
export async function routeCourier(
  organizationId: string,
  courier: CourierRef,
  org: SocleOrgWithConfig,
): Promise<{ name: string; initialStateId: string | null } | null> {
  let result: { name: string; initialStateId: string | null } | null = null;
  if (courier.socle_organization_id === org.id) {
    await insertRoutingEvent(organizationId, courier.id, "courier_routed", { to: org.name });
  } else {
    result = await assignOrganization(organizationId, courier, org);
  }
  await notifyUsers(organizationId, await orgMemberIds(org.id), "courier_transferred", `Transféré : ${subjectOf(courier)}`, courier.id);
  return result;
}

/** Route plusieurs courriers (lot « propositions ≥ 90 % ») ; un échec n'arrête pas les autres. */
export async function routeCouriers(
  organizationId: string,
  items: { courier: CourierRef; org: SocleOrgWithConfig }[],
): Promise<{ routed: string[]; failed: { id: string; error: string }[] }> {
  const results = await Promise.allSettled(items.map(({ courier, org }) => routeCourier(organizationId, courier, org)));
  const routed: string[] = [];
  const failed: { id: string; error: string }[] = [];
  results.forEach((r, i) => {
    const id = items[i].courier.id;
    if (r.status === "fulfilled") routed.push(id);
    else failed.push({ id, error: r.reason instanceof Error ? r.reason.message : String(r.reason) });
  });
  return { routed, failed };
}

/**
 * Transfert d'un service à un autre : le courrier repart à l'état initial du
 * workflow de l'organisation cible, dont les membres sont notifiés.
 */
export async function transferCourier(
  organizationId: string,
  courier: CourierRef,
  targetOrg: SocleOrgWithConfig,
): Promise<{ id: string; name: string; initialStateId: string | null }> {
  let initial: { id: string } | null = null;
  if (targetOrg.workflow_id) {
    const { data, error } = await supabase
      .from("workflow_states")
      .select("id")
      .eq("workflow_id", targetOrg.workflow_id)
      .eq("is_initial", true)
      .maybeSingle();
    if (error) throw error;
    initial = data;
  }

  const currentMeta = (courier.metadata as Record<string, unknown> | null) ?? {};
  const { error: updateErr } = await updateCourier(organizationId, courier.id, {
    assigned_service: targetOrg.name,
    socle_organization_id: targetOrg.id,
    workflow_state_id: initial?.id ?? null,
    metadata: { ...currentMeta, socle_organization_id: targetOrg.id },
  });
  if (updateErr) throw updateErr;

  await logEvent(organizationId, courier.id, "service_transferred", {
    from: courier.assigned_service ?? null,
    to: targetOrg.name,
  });

  // Non bloquant, mais pas silencieux : c'est ce silence qui avait masqué
  // l'absence de policy INSERT sur `notifications`.
  await notifyUsers(organizationId, await orgMemberIds(targetOrg.id), "courier_transferred", `Transféré : ${subjectOf(courier)}`, courier.id);

  return { id: targetOrg.id, name: targetOrg.name, initialStateId: initial?.id ?? null };
}

/**
 * Renvoi au service courrier : le service ne sait pas à qui confier le courrier
 * (ou une partie reste hors de ses attributions). Le courrier quitte
 * l'organisation et son workflow, et rejoint « À réorienter » avec ce qui a été
 * fait et ce qui reste à faire.
 */
export async function returnToMailroom(
  organizationId: string,
  courier: CourierRef,
  note: { done: string; todo: string },
): Promise<void> {
  const todo = note.todo.trim();
  if (!todo) throw new Error("Indiquez ce qui reste à faire.");
  const done = note.done.trim();

  const currentMeta = { ...((courier.metadata as Record<string, unknown> | null) ?? {}) };
  delete currentMeta.socle_organization_id;
  const { error } = await updateCourier(organizationId, courier.id, {
    assigned_service: null,
    socle_organization_id: null,
    workflow_state_id: null,
    metadata: currentMeta as never,
  });
  if (error) throw error;

  await insertRoutingEvent(organizationId, courier.id, "service_returned", {
    from: courier.assigned_service ?? null,
    done: done || null,
    todo,
  });

  let recipients: string[] = [];
  try {
    recipients = await fetchMailroomMemberIds(organizationId);
  } catch (e) {
    console.error("Service courrier introuvable :", e);
  }
  await notifyUsers(organizationId, recipients, "courier_returned", `Renvoyé : ${subjectOf(courier)}`, courier.id);
}

/** Relance du service destinataire : événement tracé + notification de ses membres. */
export async function remindService(
  organizationId: string,
  courier: CourierRef & { socle_organization_id: string | null },
): Promise<void> {
  if (!courier.socle_organization_id) throw new Error("Ce courrier n'est confié à aucun service.");
  await insertRoutingEvent(organizationId, courier.id, "service_reminded", { to: courier.assigned_service ?? null });
  await notifyUsers(
    organizationId,
    await orgMemberIds(courier.socle_organization_id),
    "courier_reminder",
    `Relance : ${subjectOf(courier)}`,
    courier.id,
  );
}
