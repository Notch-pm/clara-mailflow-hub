import { supabase } from "@/integrations/supabase/client";

export interface OrgService {
  id: string;
  organization_id: string;
  name: string;
  email: string | null;
  workflow_id: string;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  workflow?: { id: string; name: string } | null;
}

export async function listServices(orgId: string): Promise<OrgService[]> {
  const { data, error } = await supabase
    .from("services" as any)
    .select("*, workflow:workflows(id, name)")
    .eq("organization_id", orgId)
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as OrgService[];
}

export async function createService(
  orgId: string,
  payload: { name: string; email: string | null; workflow_id: string },
): Promise<OrgService> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("services" as any)
    .insert({
      organization_id: orgId,
      name: payload.name.trim(),
      email: payload.email?.trim() || null,
      workflow_id: payload.workflow_id,
      created_by: user?.id ?? null,
    } as any)
    .select("*, workflow:workflows(id, name)")
    .single();
  if (error) throw error;
  return data as unknown as OrgService;
}

export async function updateService(
  id: string,
  payload: { name: string; email: string | null; workflow_id: string },
): Promise<OrgService> {
  const { data, error } = await supabase
    .from("services" as any)
    .update({
      name: payload.name.trim(),
      email: payload.email?.trim() || null,
      workflow_id: payload.workflow_id,
    } as any)
    .eq("id", id)
    .select("*, workflow:workflows(id, name)")
    .single();
  if (error) throw error;
  return data as unknown as OrgService;
}

export async function deleteService(id: string): Promise<void> {
  const { error } = await supabase.from("services" as any).delete().eq("id", id);
  if (error) throw error;
}
