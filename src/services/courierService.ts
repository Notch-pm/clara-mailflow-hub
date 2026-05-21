import { supabase } from "@/integrations/supabase/client";
import type { CourierDirection, CourierChannel, CourierInsert, CourierUpdate } from "@/types/courier";

const LIST_SELECT =
  "id, subject, direction, channel, received_at, sent_at, workflow_state_id, assigned_service, metadata, chrono, created_at, updated_at, courier_participants(id, role, name, email, usager_id)";

interface CourierFilters {
  direction?: CourierDirection;
  channel?: CourierChannel;
  search?: string;
  limit?: number;
  offset?: number;
}

export async function getCouriers(organizationId: string, filters?: CourierFilters) {
  const limit = filters?.limit ?? 200;
  const offset = filters?.offset ?? 0;

  let query = supabase
    .from("couriers")
    .select(LIST_SELECT, { count: "exact" })
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (filters?.direction) query = query.eq("direction", filters.direction);
  if (filters?.channel) query = query.eq("channel", filters.channel);
  if (filters?.search) query = query.ilike("subject", `%${filters.search}%`);

  return query;
}

export async function getCourierById(organizationId: string, courierId: string) {
  return supabase
    .from("couriers")
    .select("*, courier_participants(*), courier_documents(*), courier_events(*), courier_links(*)")
    .eq("organization_id", organizationId)
    .eq("id", courierId)
    .single();
}

export async function createCourier(data: CourierInsert) {
  return supabase
    .from("couriers")
    .insert(data)
    .select()
    .single();
}

export async function updateCourier(organizationId: string, courierId: string, data: CourierUpdate) {
  return supabase
    .from("couriers")
    .update(data)
    .eq("organization_id", organizationId)
    .eq("id", courierId)
    .select()
    .single();
}

export async function deleteCourier(organizationId: string, courierId: string) {
  return supabase
    .from("couriers")
    .delete()
    .eq("organization_id", organizationId)
    .eq("id", courierId);
}
