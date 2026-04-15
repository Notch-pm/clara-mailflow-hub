import { supabase } from "@/integrations/supabase/client";
import type { CourierEvent } from "@/types/courier";

export async function getEvents(courierId: string) {
  return supabase
    .from("courier_events")
    .select("*")
    .eq("courier_id", courierId)
    .order("created_at", { ascending: false });
}

export async function addEvent(data: Omit<CourierEvent, "id" | "created_at">) {
  return supabase
    .from("courier_events")
    .insert(data)
    .select()
    .single();
}
