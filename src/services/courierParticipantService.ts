import { supabase } from "@/integrations/supabase/client";
import type { CourierParticipantInsert } from "@/types/courier";

/** Courrier lié à un contact Socle (via courier_participants.socle_contact_id). */
export interface ContactCourier {
  id: string;
  /** « [courrier confidentiel] » quand `can_read` est faux : le serveur masque. */
  subject: string | null;
  received_at: string | null;
  sent_at: string | null;
  direction: string;
  /** Renseigné pour une réponse : le courrier auquel elle répond. */
  parent_courier_id: string | null;
  channel: string | null;
  chrono: string | null;
  created_at: string;
  workflow_state: { name: string; category: string } | null;
  is_confidential: boolean;
  can_read: boolean;
}

interface ContactCourierRow extends Omit<ContactCourier, "workflow_state"> {
  workflow_state_name: string | null;
  workflow_state_category: string | null;
}

/**
 * Liste des courriers auxquels un contact Socle participe (tous rôles), du plus
 * récent au plus ancien. Par RPC (`contact_couriers`) : une lecture directe des
 * participants ferait DISPARAÎTRE un courrier confidentiel, que l'historique
 * doit montrer masqué. Donnée 100 % Clara : seul l'identifiant Socle est stocké.
 */
export async function listContactCouriers(organizationId: string, socleContactId: string): Promise<ContactCourier[]> {
  const { data, error } = await supabase.rpc("contact_couriers", {
    p_organization_id: organizationId,
    p_socle_contact_id: socleContactId,
  });
  if (error) throw error;
  return ((data ?? []) as unknown as ContactCourierRow[]).map(({ workflow_state_name, workflow_state_category, ...c }) => ({
    ...c,
    workflow_state: workflow_state_name ? { name: workflow_state_name, category: workflow_state_category ?? "" } : null,
  }));
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
