// État d'une interface partenaire (Arpège) pour un tenant — sans aucun secret.
//
// La configuration elle-même est réservée au superadmin (RLS) ; tout membre de
// l'organisation peut en revanche savoir si l'interface est configurée et
// active, via la RPC SECURITY DEFINER `partner_integration_status`. C'est ce
// qui permet de griser une démarche Arpège quand l'interface est suspendue.
import { supabase } from "@/integrations/supabase/client";

export interface PartnerIntegrationStatus {
  configured: boolean;
  is_active: boolean;
}

export async function getPartnerIntegrationStatus(
  organizationId: string,
  provider = "arpege",
): Promise<PartnerIntegrationStatus> {
  const { data, error } = await supabase.rpc("partner_integration_status", {
    p_organization_id: organizationId,
    p_provider: provider,
  });
  if (error) throw error;
  const row = (data ?? [])[0];
  return { configured: !!row?.configured, is_active: !!row?.is_active };
}
