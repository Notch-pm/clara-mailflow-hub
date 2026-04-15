import { supabase } from "@/integrations/supabase/client";
import type { CourierDirection, CourierChannel, CourierInsert, CourierUpdate } from "@/types/courier";

interface CourierFilters {
  direction?: CourierDirection;
  channel?: CourierChannel;
  search?: string;
}

export async function getCouriers(organizationId: string, filters?: CourierFilters) {
  let query = supabase
    .from("couriers")
    .select("*, courier_participants(*), courier_documents(*)")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });

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
