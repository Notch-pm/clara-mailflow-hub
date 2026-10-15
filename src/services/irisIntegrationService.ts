import { supabase } from "@/integrations/supabase/client";

/**
 * État de la connexion Iris d'un tenant — jamais la clé. Depuis le 2026-10-15,
 * la connexion est déduite de l'abonnement de la collectivité à Iris dans le
 * Socle et écrite par la synchronisation du référentiel : rien ne se saisit
 * dans Clara.
 */
export interface IrisIntegrationStatus {
  is_active: boolean | null;
  socle_root_org_id: string | null;
  socle_synced_at: string | null;
  last_sync_at: string | null;
}

export async function getIrisIntegrationStatus(organizationId: string): Promise<IrisIntegrationStatus | null> {
  const { data, error } = await supabase
    .from("organization_integrations")
    .select("is_active, socle_root_org_id, socle_synced_at, last_sync_at")
    .eq("organization_id", organizationId)
    .eq("provider", "iris")
    .maybeSingle();
  if (error) throw error;
  return data;
}
