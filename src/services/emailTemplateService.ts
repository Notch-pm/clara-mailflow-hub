import { supabase } from "@/integrations/supabase/client";
import type { EmailTemplate } from "@/lib/email-templates";

export type { EmailTemplate };

/**
 * Modèles de courriels du Socle cochés pour Clara (miroir `socle_email_templates`, écrit
 * par la synchronisation du référentiel). Lecture seule : titre, texte et organismes se
 * règlent dans le Socle.
 */
export async function listEmailTemplates(orgId: string): Promise<EmailTemplate[]> {
  const { data, error } = await supabase
    .from("socle_email_templates")
    .select("id, socle_id, name, description, subject, body, socle_organization_ids, socle_updated_at, synced_at")
    .eq("organization_id", orgId)
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as EmailTemplate[];
}
