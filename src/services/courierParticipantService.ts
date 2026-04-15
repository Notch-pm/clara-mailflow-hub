import { supabase } from "@/integrations/supabase/client";
import type { CourierParticipant } from "@/types/courier";

export async function getParticipants(courierId: string) {
  return supabase
    .from("courier_participants")
    .select("*")
    .eq("courier_id", courierId)
    .order("created_at");
}

export async function addParticipant(data: Omit<CourierParticipant, "id" | "created_at">) {
  return supabase
    .from("courier_participants")
    .insert(data)
    .select()
    .single();
}

export async function removeParticipant(participantId: string) {
  return supabase
    .from("courier_participants")
    .delete()
    .eq("id", participantId);
}
