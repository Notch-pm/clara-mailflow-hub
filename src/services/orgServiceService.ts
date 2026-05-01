import { supabase } from "@/integrations/supabase/client";

export interface OrgService {
  id: string;
  organization_id: string;
  name: string;
  email: string | null;
  imap_settings_id: string | null;
  workflow_id: string;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  workflow?: { id: string; name: string } | null;
  imap_config?: { id: string; label: string; username: string } | null;
}

export async function listServices(orgId: string): Promise<OrgService[]> {
  const { data, error } = await supabase
    .from("services")
    .select("*, workflow:workflows(id, name), imap_config:imap_settings(id, label, username)")
    .eq("organization_id", orgId)
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as OrgService[];
}

export async function createService(
  orgId: string,
  payload: { name: string; email: string | null; workflow_id: string; imap_settings_id?: string | null },
): Promise<OrgService> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("services")
    .insert({
      organization_id: orgId,
      name: payload.name.trim(),
      email: payload.email?.trim() || null,
      workflow_id: payload.workflow_id,
      imap_settings_id: payload.imap_settings_id ?? null,
      created_by: user?.id ?? null,
    })
    .select("*, workflow:workflows(id, name), imap_config:imap_settings(id, label, username)")
    .single();
  if (error) throw error;
  return data as unknown as OrgService;
}

export async function updateService(
  id: string,
  payload: { name: string; email: string | null; workflow_id: string; imap_settings_id?: string | null },
): Promise<OrgService> {
  const { data, error } = await supabase
    .from("services")
    .update({
      name: payload.name.trim(),
      email: payload.email?.trim() || null,
      workflow_id: payload.workflow_id,
      imap_settings_id: payload.imap_settings_id ?? null,
    })
    .eq("id", id)
    .select("*, workflow:workflows(id, name), imap_config:imap_settings(id, label, username)")
    .single();
  if (error) throw error;
  return data as unknown as OrgService;
}

export async function deleteService(id: string): Promise<void> {
  const { data: svc, error: fetchErr } = await supabase
    .from("services")
    .select("name, organization_id")
    .eq("id", id)
    .single();
  if (fetchErr) throw fetchErr;
  const service = svc as unknown as { name: string; organization_id: string };

  const { count, error: countErr } = await supabase
    .from("couriers")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", service.organization_id)
    .eq("assigned_service", service.name);
  if (countErr) throw countErr;

  if ((count ?? 0) > 0) {
    throw new Error(
      `Impossible de supprimer ce service : ${count} courrier(s) y sont associés.`,
    );
  }

  const { error } = await supabase.from("services").delete().eq("id", id);
  if (error) throw error;
}
