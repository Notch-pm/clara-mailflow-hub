import { supabase } from "@/integrations/supabase/client";

export async function getWorkflows(organizationId: string) {
  return supabase
    .from("workflows")
    .select("*, workflow_states(*), workflow_transitions(*)")
    .eq("organization_id", organizationId)
    .order("created_at");
}

export async function getWorkflowById(organizationId: string, workflowId: string) {
  return supabase
    .from("workflows")
    .select("*, workflow_states(*), workflow_transitions(*)")
    .eq("organization_id", organizationId)
    .eq("id", workflowId)
    .single();
}
