import { supabase } from "@/integrations/supabase/client";

/**
 * Corbeille des courriers (migration `20261001120000_corbeille_courriers.sql`).
 * Un courrier supprimé y reste 30 jours, restaurable, avant la purge nocturne.
 * La RLS masque la corbeille aux lectures directes : tout passe par des RPC.
 *
 * Typé ici plutôt que via `types.ts` : le générateur rend toutes les colonnes
 * d'un `RETURNS TABLE` non nullables, ce qu'elles ne sont pas.
 */
export interface TrashRow {
  id: string;
  chrono: string | null;
  subject: string | null;
  direction: "inbound" | "outbound" | string;
  channel: "paper" | "email" | "portal" | string;
  received_at: string | null;
  created_at: string;
  deleted_at: string;
  deleted_by_name: string | null;
  /** Date de la suppression définitive (deleted_at + 30 jours). */
  purge_at: string;
  sender_name: string | null;
  /** Réponses parties dans la corbeille avec le courrier. */
  reply_count: number;
}

export async function fetchTrashedCouriers(organizationId: string): Promise<TrashRow[]> {
  const { data, error } = await supabase.rpc("trashed_couriers", { p_organization_id: organizationId });
  if (error) throw error;
  return (data ?? []) as unknown as TrashRow[];
}

/** Met un courrier (et ses réponses) à la corbeille. */
export async function trashCourier(organizationId: string, courierId: string) {
  const { error } = await supabase.rpc("trash_courier", {
    p_organization_id: organizationId,
    p_courier_id: courierId,
  });
  if (error) throw error;
}

export async function restoreCourier(organizationId: string, courierId: string) {
  const { error } = await supabase.rpc("restore_courier", {
    p_organization_id: organizationId,
    p_courier_id: courierId,
  });
  if (error) throw error;
}

/** Suppression définitive d'un courrier de la corbeille (pièces jointes comprises). */
export async function purgeTrashedCourier(organizationId: string, courierId: string) {
  const { error } = await supabase.rpc("purge_trashed_courier", {
    p_organization_id: organizationId,
    p_courier_id: courierId,
  });
  if (error) throw error;
}

/** Vide la corbeille ; renvoie le nombre de courriers supprimés définitivement. */
export async function emptyTrash(organizationId: string): Promise<number> {
  const { data, error } = await supabase.rpc("empty_trash", { p_organization_id: organizationId });
  if (error) throw error;
  return data ?? 0;
}
