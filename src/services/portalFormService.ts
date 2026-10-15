import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

/**
 * Formulaire portail citoyen ; `socle_organization_id` désigne l'organisation
 * destinataire des soumissions.
 */
export type PortalForm = Tables<"portal_forms">;

export interface PortalFormInsert {
  organization_id: string;
  socle_organization_id?: string | null;
  name: string;
  description?: string | null;
  allowed_origins?: string[] | null;
}

export async function getPortalForms(organizationId: string): Promise<PortalForm[]> {
  const { data, error } = await supabase
    .from("portal_forms")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function createPortalForm(form: PortalFormInsert): Promise<PortalForm> {
  const { data, error } = await supabase.from("portal_forms").insert(form).select("*").single();
  if (error) throw error;
  return data;
}

export async function updatePortalForm(
  organizationId: string,
  formId: string,
  patch: Partial<Pick<PortalForm, "name" | "description" | "is_active" | "allowed_origins" | "socle_organization_id">>,
): Promise<PortalForm> {
  const { data, error } = await supabase
    .from("portal_forms")
    .update(patch)
    .eq("organization_id", organizationId)
    .eq("id", formId)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function deletePortalForm(organizationId: string, formId: string): Promise<void> {
  const { error } = await supabase.from("portal_forms").delete().eq("organization_id", organizationId).eq("id", formId);
  if (error) throw error;
}
