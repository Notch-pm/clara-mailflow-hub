import { supabase } from "@/integrations/supabase/client";
import type { CourierParticipantInsert } from "@/types/courier";

export async function getParticipants(courierId: string) {
  const { data, error } = await supabase
    .from("courier_participants")
    .select("*")
    .eq("courier_id", courierId)
    .order("role");

  if (error) throw error;
  return data ?? [];
}

export async function addParticipant(data: CourierParticipantInsert) {
  const { data: result, error } = await supabase
    .from("courier_participants")
    .insert(data)
    .select()
    .single();

  if (error) throw error;
  return result;
}

export async function updateParticipant(
  participantId: string,
  updates: {
    name?: string | null;
    email?: string | null;
    address?: string | null;
    organization?: string | null;
    role?: "sender" | "recipient" | "cc";
  }
) {
  const { data, error } = await supabase
    .from("courier_participants")
    .update(updates)
    .eq("id", participantId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function removeParticipant(participantId: string) {
  const { error } = await supabase
    .from("courier_participants")
    .delete()
    .eq("id", participantId);

  if (error) throw error;
}
