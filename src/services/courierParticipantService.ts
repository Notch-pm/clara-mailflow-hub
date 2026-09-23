import { supabase } from "@/integrations/supabase/client";
import type { CourierParticipantInsert } from "@/types/courier";

/** Courrier lié à un contact Socle (via courier_participants.socle_contact_id). */
export interface ContactCourier {
  id: string;
  subject: string | null;
  received_at: string | null;
  sent_at: string | null;
  direction: string;
  /** Renseigné pour une réponse : le courrier auquel elle répond. */
  parent_courier_id: string | null;
  channel: string | null;
  chrono: string | null;
  created_at: string;
  metadata: Record<string, unknown> | null;
  workflow_state: { name: string; category: string } | null;
}

/**
 * Liste des courriers auxquels un contact Socle participe (tous rôles),
 * dédupliqués et triés du plus récent au plus ancien. Donnée 100 % Clara :
 * seul l'identifiant Socle est stocké, jamais l'identité.
 */
export async function listContactCouriers(socleContactId: string): Promise<ContactCourier[]> {
  const { data, error } = await supabase
    .from("courier_participants")
    .select(
      "courier_id, role, courier:couriers(id, subject, received_at, sent_at, direction, parent_courier_id, channel, chrono, created_at, metadata, workflow_state:workflow_states(name, category))",
    )
    .eq("socle_contact_id", socleContactId);
  if (error) throw error;

  interface ParticipantRow {
    courier: ContactCourier | null;
  }
  const couriers = ((data ?? []) as unknown as ParticipantRow[])
    .map((r) => r.courier)
    .filter((c): c is ContactCourier => c !== null);

  const seen = new Set<string>();
  const out: ContactCourier[] = [];
  for (const c of couriers) {
    if (!seen.has(c.id)) {
      seen.add(c.id);
      out.push(c);
    }
  }
  out.sort((a, b) => {
    const da = a.received_at ?? a.sent_at ?? a.created_at;
    const db = b.received_at ?? b.sent_at ?? b.created_at;
    return new Date(db).getTime() - new Date(da).getTime();
  });
  return out;
}

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
    first_name?: string | null;
    last_name?: string | null;
    email?: string | null;
    phone?: string | null;
    address?: string | null;
    organization?: string | null;
    role?: "sender" | "recipient" | "cc";
    socle_contact_id?: string | null;
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
