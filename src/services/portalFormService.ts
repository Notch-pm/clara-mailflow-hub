import { supabase } from "@/integrations/supabase/client";

// portal_forms n'est pas encore dans types.ts auto-généré — cast explicite.
const db = supabase as any;

export interface PortalForm {
  id: string;
  organization_id: string;
  service_id: string | null;
  token: string;
  name: string;
  description: string | null;
  is_active: boolean;
  allowed_origins: string[] | null;
  config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  services?: { name: string } | null;
}

export interface PortalFormInsert {
  organization_id: string;
  service_id?: string | null;
  name: string;
  description?: string | null;
  allowed_origins?: string[] | null;
}

export async function getPortalForms(organizationId: string) {
  return db
    .from("portal_forms")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false }) as Promise<{ data: PortalForm[] | null; error: unknown }>;
}

export async function createPortalForm(data: PortalFormInsert) {
  return db
    .from("portal_forms")
    .insert(data)
    .select("*")
    .single() as Promise<{ data: PortalForm | null; error: unknown }>;
}

export async function updatePortalForm(
  organizationId: string,
  formId: string,
  patch: Partial<Pick<PortalForm, "name" | "description" | "is_active" | "allowed_origins" | "service_id">>,
) {
  return db
    .from("portal_forms")
    .update(patch)
    .eq("organization_id", organizationId)
    .eq("id", formId)
    .select("*")
    .single() as Promise<{ data: PortalForm | null; error: unknown }>;
}

export async function deletePortalForm(organizationId: string, formId: string) {
  return db
    .from("portal_forms")
    .delete()
    .eq("organization_id", organizationId)
    .eq("id", formId) as Promise<{ error: unknown }>;
}
