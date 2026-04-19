import { supabase } from "@/integrations/supabase/client";

export interface ActionTicket {
  id: string;
  organization_id: string;
  courier_id: string;
  procedure_id: string;
  description: string | null;
  status: string;
  assignee_id: string | null;
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
      "*, procedure:procedures(id, name, color, icon), assignee:users!action_tickets_assignee_id_fkey(id, first_name, last_name, email, avatar_url)",
    )
    .eq("courier_id", courierId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as ActionTicketWithProcedure[];
}

export async function createTicket(payload: {
  organizationId: string;
  courierId: string;
  procedureId: string;
  description?: string | null;
  assigneeId?: string | null;
}): Promise<ActionTicket> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("action_tickets" as any)
    .insert({
      organization_id: payload.organizationId,
      courier_id: payload.courierId,
      procedure_id: payload.procedureId,
      description: payload.description?.trim() || null,
      assignee_id: payload.assigneeId ?? null,
      created_by: user?.id ?? null,
    } as any)
    .select("*")
    .single();
  if (error) throw error;
  return data as unknown as ActionTicket;
}

export async function updateTicket(
  id: string,
  updates: { description?: string | null; assigneeId?: string | null; procedureId?: string },
): Promise<void> {
  const payload: Record<string, any> = {};
  if (updates.description !== undefined) payload.description = updates.description?.trim() || null;
  if (updates.assigneeId !== undefined) payload.assignee_id = updates.assigneeId ?? null;
  if (updates.procedureId !== undefined) payload.procedure_id = updates.procedureId;
  const { error } = await supabase
    .from("action_tickets" as any)
    .update(payload as any)
    .eq("id", id);
  if (error) throw error;
}

export async function deleteTicket(id: string): Promise<void> {
  const { error } = await supabase.from("action_tickets" as any).delete().eq("id", id);
  if (error) throw error;
}
