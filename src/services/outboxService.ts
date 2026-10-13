import { supabase } from "@/integrations/supabase/client";

/**
 * Écran « Courriers sortants » : une ligne légère par sortant en cours, ou
 * parti / clôturé depuis `since` (RPC `outbound_couriers`, migration
 * `20261013142643_courriers_sortants_ecran.sql`). Le classement en onglets se
 * calcule côté client (`src/lib/outbox.ts`).
 *
 * Typé ici plutôt que via `types.ts` : le générateur rend toutes les colonnes
 * d'un `RETURNS TABLE` non nullables, ce qu'elles ne sont pas.
 */
export interface OutboxRow {
  id: string;
  chrono: string | null;
  subject: string | null;
  channel: string;
  parent_courier_id: string | null;
  parent_chrono: string | null;
  parent_subject: string | null;
  socle_organization_id: string | null;
  created_at: string;
  /** Leurre sur les anciennes réponses : ne dit pas, seul, qu'un courrier est parti. */
  sent_at: string | null;
  state_id: string | null;
  state_name: string | null;
  state_is_initial: boolean;
  state_is_final: boolean;
  state_is_send: boolean;
  state_requires_visa: boolean;
  state_requires_signature: boolean;
  signed_at: string | null;
  sent_email_at: string | null;
  posted_at: string | null;
  recipient_name: string | null;
  recipient_contact_id: string | null;
  /** Entrée dans l'état courant (à défaut, création du courrier). */
  state_since: string;
  /** Courrier confidentiel ; illisible pour moi si `can_read` est faux (objet et destinataire masqués). */
  is_confidential?: boolean;
  can_read?: boolean;
}

export async function fetchOutboundCouriers(organizationId: string, since: Date): Promise<OutboxRow[]> {
  const { data, error } = await supabase.rpc("outbound_couriers", {
    p_organization_id: organizationId,
    p_since: since.toISOString(),
  });
  if (error) throw error;
  return (data ?? []) as unknown as OutboxRow[];
}

/**
 * Organisations dont je vise ou signe les sortants. Un viseur ou un signataire
 * n'est pas forcément membre de l'organisation gestionnaire : sans elles, le
 * filtre de service lui cacherait les courriers mêmes qui l'attendent.
 */
export async function listMyApprovalOrgIds(organizationId: string, userId: string): Promise<string[]> {
  const [viseurs, signatories] = await Promise.all([
    supabase
      .from("socle_organization_viseurs")
      .select("socle_organization_id")
      .eq("organization_id", organizationId)
      .eq("user_id", userId),
    supabase
      .from("socle_organization_signatories")
      .select("socle_organization_id, signatory:signatories!inner(user_id)")
      .eq("organization_id", organizationId)
      .eq("signatory.user_id", userId),
  ]);
  if (viseurs.error) throw viseurs.error;
  if (signatories.error) throw signatories.error;
  const ids = [
    ...((viseurs.data ?? []) as { socle_organization_id: string }[]),
    ...((signatories.data ?? []) as unknown as { socle_organization_id: string }[]),
  ].map((r) => r.socle_organization_id);
  return [...new Set(ids)];
}
