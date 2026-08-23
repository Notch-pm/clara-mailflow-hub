import { supabase } from "@/integrations/supabase/client";

/**
 * Prévient le destinataire d'une affectation (mail + in-app). L'edge function
 * relit le ticket côté serveur et ignore l'auto-affectation.
 */
async function notifyAssignment(ticketId: string) {
  try {
    await supabase.functions.invoke("send-assignment-notification", {
      body: { ticket_id: ticketId },
    });
  } catch (e) {
    // Non-bloquant : l'échec d'une notification ne doit pas faire échouer l'affectation.
    console.warn("notifyAssignment failed", e);
  }
}

/**
 * Prévient l'ancien titulaire qu'une action ne lui incombe plus. Il doit être
 * nommé explicitement : l'edge function relit le ticket après l'update, où il
 * ne figure plus.
 */
async function notifyUnassignment(ticketId: string, previousAssigneeId: string) {
  try {
    await supabase.functions.invoke("send-assignment-notification", {
      body: { ticket_id: ticketId, unassigned_user_id: previousAssigneeId },
    });
  } catch (e) {
    console.warn("notifyUnassignment failed", e);
  }
}

export async function createArpegeTicket(payload: {
  organizationId: string;
  courierId: string;
  procedureId: string;
  description?: string | null;
  assigneeId?: string | null;
  demandeur: Record<string, string>;
  formValues?: Array<{ id: string; valeur: unknown }>;
  pieceJointes?: Record<string, string[]>;
}): Promise<ActionTicket> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Non authentifié");

  const res = await supabase.functions.invoke("create-arpege-demande", {
    body: {
      organization_id: payload.organizationId,
      courier_id: payload.courierId,
      procedure_id: payload.procedureId,
      description: payload.description?.trim() || null,
      assignee_id: payload.assigneeId ?? null,
      demandeur: payload.demandeur,
      form_values: payload.formValues ?? [],
      pieces_jointes: payload.pieceJointes ?? {},
    },
  });

  if (res.error) throw new Error(res.error.message);
  const data = res.data as { ticket: ActionTicket; arpege_ref: string };
  if (!data?.ticket) throw new Error("Réponse invalide de l'edge function");
  if (data.ticket.assignee_id) await notifyAssignment(data.ticket.id);
  return data.ticket;
}

export interface ActionTicket {
  id: string;
  organization_id: string;
  courier_id: string;
  procedure_id: string | null;
  title: string | null;
  description: string | null;
  status: string;
  assignee_id: string | null;
  arpege_demande_ref: string | null;
  arpege_demande_status: string | null;
  socle_data: unknown;
  /** Suivi de la demande déposée dans Iris — écrit par le serveur uniquement. */
  iris_request_id: string | null;
  iris_reference: string | null;
  /** Liste fermée servie par Iris ; libellés d'affichage dans `src/lib/iris.ts`. */
  iris_status: string | null;
  iris_url: string | null;
  /** Dernier échec de dépôt, en français. Non nul = demande à renvoyer. */
  iris_last_error: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ActionTicketAssignee {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  avatar_url: string | null;
}

export interface ActionTicketWithProcedure extends ActionTicket {
  procedure?: {
    id: string;
    name: string;
    color: string | null;
    icon: string | null;
  } | null;
  assignee?: ActionTicketAssignee | null;
}

export async function listTicketsForCourier(
  courierId: string,
): Promise<ActionTicketWithProcedure[]> {
  const { data, error } = await supabase
    .from("action_tickets" as any)
    .select(
      "*, procedure:procedures!action_tickets_procedure_id_fkey(id, name, color, icon), assignee:users!action_tickets_assignee_id_fkey(id, first_name, last_name, email, avatar_url)",
    )
    .eq("courier_id", courierId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as ActionTicketWithProcedure[];
}

export async function createTicket(payload: {
  organizationId: string;
  courierId: string;
  /** Facultatif : une action libre n'est rattachée à aucune démarche. */
  procedureId?: string | null;
  title?: string | null;
  description?: string | null;
  assigneeId?: string | null;
  /** Valeurs saisies pour une démarche Socle (demandeur + formulaire), voir socle-form.ts. */
  socleData?: unknown;
}): Promise<ActionTicket> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("action_tickets" as any)
    .insert({
      organization_id: payload.organizationId,
      courier_id: payload.courierId,
      procedure_id: payload.procedureId ?? null,
      title: payload.title?.trim() || null,
      description: payload.description?.trim() || null,
      assignee_id: payload.assigneeId ?? null,
      socle_data: payload.socleData ?? null,
      created_by: user?.id ?? null,
    } as any)
    .select("*")
    .single();
  if (error) throw error;
  const created = data as unknown as ActionTicket;
  if (created.assignee_id) await notifyAssignment(created.id);
  return created;
}

export async function updateTicket(
  id: string,
  updates: {
    title?: string | null;
    description?: string | null;
    assigneeId?: string | null;
    procedureId?: string | null;
  },
): Promise<void> {
  const payload: Record<string, any> = {};
  if (updates.title !== undefined) payload.title = updates.title?.trim() || null;
  if (updates.description !== undefined) payload.description = updates.description?.trim() || null;
  if (updates.assigneeId !== undefined) payload.assignee_id = updates.assigneeId ?? null;
  if (updates.procedureId !== undefined) payload.procedure_id = updates.procedureId ?? null;

  // Relu avant l'update : seule une *nouvelle* affectation doit notifier, pas
  // une modification de titre sur un ticket déjà affecté.
  let previousAssigneeId: string | null = null;
  if (updates.assigneeId !== undefined) {
    const { data: before } = await supabase
      .from("action_tickets")
      .select("assignee_id")
      .eq("id", id)
      .single();
    previousAssigneeId = before?.assignee_id ?? null;
  }

  const { error } = await supabase
    .from("action_tickets" as any)
    .update(payload as any)
    .eq("id", id);
  if (error) throw error;

  const nextAssigneeId = updates.assigneeId ?? null;
  if (updates.assigneeId !== undefined && nextAssigneeId !== previousAssigneeId) {
    // Une réaffectation est un retrait pour l'ancien titulaire : les deux
    // parties sont prévenues.
    if (previousAssigneeId) await notifyUnassignment(id, previousAssigneeId);
    if (nextAssigneeId) await notifyAssignment(id);
  }
}

export async function deleteTicket(id: string): Promise<void> {
  const { error } = await supabase.from("action_tickets" as any).delete().eq("id", id);
  if (error) throw error;
}
