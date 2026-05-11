import { supabase } from "@/integrations/supabase/client";

export interface OrgService {
  id: string;
  organization_id: string;
  name: string;
  email: string | null;
  imap_settings_id: string | null;
  workflow_id: string;
  reply_workflow_id: string | null;
  address_street: string | null;
  address_complement: string | null;
  address_postal_code: string | null;
  address_city: string | null;
  phone: string | null;
  website: string | null;
  contact_email: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  workflow?: { id: string; name: string } | null;
  reply_workflow?: { id: string; name: string } | null;
  imap_config?: { id: string; label: string; username: string } | null;
}

export interface ServiceContactPayload {
  address_street?: string | null;
  address_complement?: string | null;
  address_postal_code?: string | null;
  address_city?: string | null;
  phone?: string | null;
  website?: string | null;
  contact_email?: string | null;
}

const SELECT_FRAGMENT =
  "*, workflow:workflows!services_workflow_id_fkey(id, name), reply_workflow:workflows!services_reply_workflow_id_fkey(id, name), imap_config:imap_settings(id, label, username)";

// Fallback select without explicit FK names (in case relationships aren't named)
const SELECT_BASIC = "*, imap_config:imap_settings(id, label, username)";

async function selectWithWorkflows(query: any) {
  // Try with explicit FK names first
  let res = await query.select(SELECT_FRAGMENT).single();
  if (res.error) {
    // Fallback: fetch row + workflows separately
    res = await query.select(SELECT_BASIC).single();
  }
  return res;
}

export async function listServices(orgId: string): Promise<OrgService[]> {
  const { data, error } = await supabase
    .from("services")
    .select(SELECT_BASIC)
    .eq("organization_id", orgId)
    .order("name", { ascending: true });
  if (error) throw error;

  const services = (data ?? []) as unknown as OrgService[];

  // Fetch workflows for both columns
  const wfIds = new Set<string>();
  services.forEach((s) => {
    if (s.workflow_id) wfIds.add(s.workflow_id);
    if (s.reply_workflow_id) wfIds.add(s.reply_workflow_id);
  });
  if (wfIds.size > 0) {
    const { data: wfs } = await supabase
      .from("workflows")
      .select("id, name")
      .in("id", Array.from(wfIds));
    const map = new Map((wfs ?? []).map((w: any) => [w.id, w]));
    services.forEach((s) => {
      s.workflow = s.workflow_id ? (map.get(s.workflow_id) ?? null) : null;
      s.reply_workflow = s.reply_workflow_id ? (map.get(s.reply_workflow_id) ?? null) : null;
    });
  }

  return services;
}

export async function createService(
  orgId: string,
  payload: {
    name: string;
    email: string | null;
    workflow_id: string;
    reply_workflow_id?: string | null;
    imap_settings_id?: string | null;
  },
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
      reply_workflow_id: payload.reply_workflow_id ?? null,
      imap_settings_id: payload.imap_settings_id ?? null,
      created_by: user?.id ?? null,
    })
    .select(SELECT_BASIC)
    .single();
  if (error) throw error;
  return data as unknown as OrgService;
}

export async function updateService(
  id: string,
  payload: {
    name: string;
    email: string | null;
    workflow_id: string;
    reply_workflow_id?: string | null;
    imap_settings_id?: string | null;
  },
): Promise<OrgService> {
  const { data, error } = await supabase
    .from("services")
    .update({
      name: payload.name.trim(),
      email: payload.email?.trim() || null,
      workflow_id: payload.workflow_id,
      reply_workflow_id: payload.reply_workflow_id ?? null,
      imap_settings_id: payload.imap_settings_id ?? null,
    })
    .eq("id", id)
    .select(SELECT_BASIC)
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
