import { supabase } from "@/integrations/supabase/client";

/**
 * Écran « Courrier entrant » du gestionnaire courrier : une ligne légère par
 * courrier reçu non résolu, ou résolu depuis `since` (RPC `mailroom_couriers`,
 * migration `20261001074711_courrier_entrant.sql`). Le classement en onglets et
 * les échéances se calculent côté client (`src/lib/mailroom.ts`).
 *
 * Typé ici plutôt que via `types.ts` : le générateur rend toutes les colonnes
 * d'un `RETURNS TABLE` non nullables, ce qu'elles ne sont pas.
 */
export interface MailroomRow {
  id: string;
  chrono: string | null;
  subject: string | null;
  channel: "paper" | "email" | "portal" | string;
  received_at: string | null;
  created_at: string;
  socle_organization_id: string | null;
  assigned_service: string | null;
  workflow_state_id: string | null;
  state_is_initial: boolean;
  state_category: string | null;
  acknowledged_at: string | null;
  resolved_at: string | null;
  sender_name: string | null;
  /** Dernier job de la file d'analyse : pending, running, done, failed — `null` sans job. */
  analysis_status: string | null;
  has_analysis: boolean;
  suggested_socle_organization_id: string | null;
  suggested_service_reason: string | null;
  suggested_service_confidence: number | null;
  suggested_service_alternatives: string[];
  first_intent: string | null;
  /** Dernier routage (affectation, transfert, routage depuis l'écran) — `null` si renvoyé ou jamais routé. */
  routed_at: string | null;
  /** Prise en charge par le service (premier `instruction_started` depuis le dernier routage). */
  taken_at: string | null;
  reminder_count: number;
  last_reminder_at: string | null;
  /** Renvoi au service courrier : renseignés si c'est le dernier événement de routage. */
  returned_from: string | null;
  returned_at: string | null;
  returned_done: string | null;
  returned_todo: string | null;
}

export async function fetchMailroomCouriers(organizationId: string, since: Date): Promise<MailroomRow[]> {
  const { data, error } = await supabase.rpc("mailroom_couriers", {
    p_organization_id: organizationId,
    p_since: since.toISOString(),
  });
  if (error) throw error;
  return (data ?? []) as unknown as MailroomRow[];
}

/** Membres actifs du service courrier de la collectivité (pour les notifier). */
export async function fetchMailroomMemberIds(organizationId: string): Promise<string[]> {
  const { data, error } = await supabase.rpc("mailroom_member_ids", { p_organization_id: organizationId });
  if (error) throw error;
  return (data ?? []) as unknown as string[];
}

/** Ce que les gestes de routage écrivent ou recopient (métadonnées comprises). */
export interface MailroomCourierRef {
  id: string;
  subject: string | null;
  assigned_service: string | null;
  socle_organization_id: string | null;
  metadata: Record<string, unknown> | null;
}

export async function getMailroomCourier(organizationId: string, courierId: string): Promise<MailroomCourierRef> {
  const { data, error } = await supabase
    .from("couriers")
    .select("id, subject, assigned_service, socle_organization_id, metadata")
    .eq("organization_id", organizationId)
    .eq("id", courierId)
    .single();
  if (error) throw error;
  return data as unknown as MailroomCourierRef;
}
