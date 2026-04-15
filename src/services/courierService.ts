import { supabase } from "@/integrations/supabase/client";
import type { Courier, CourierType, CourierStatus } from "@/types/courier";

interface CourierFilters {
  type?: CourierType;
  status?: CourierStatus;
  search?: string;
}

export async function getCouriers(organizationId: string, filters?: CourierFilters) {
  let query = supabase
    .from("couriers")
    .select("*, courier_participants(*), courier_documents(*)")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });

  if (filters?.type) query = query.eq("type", filters.type);
  if (filters?.status) query = query.eq("status", filters.status);
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

export async function createCourier(organizationId: string, data: Partial<Courier>) {
  return supabase
    .from("couriers")
    .insert({ ...data, organization_id: organizationId })
    .select()
    .single();
}

export async function updateCourier(organizationId: string, courierId: string, data: Partial<Courier>) {
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
