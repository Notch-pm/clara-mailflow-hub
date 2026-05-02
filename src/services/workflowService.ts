import { supabase } from "@/integrations/supabase/client";
import type { WorkflowCategory } from "@/types/courier";

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

export type WorkflowType = "inbound" | "reply";

export async function createWorkflow(organizationId: string, name: string, type: WorkflowType) {
  const result = await supabase
    .from("workflows")
    .insert({ organization_id: organizationId, name, type, is_default: false })
    .select()
    .single();

  if (result.error || !result.data) return result;

  if (type === "reply") {
    // Seed default states for a reply workflow (no archive)
    const wfId = (result.data as { id: string }).id;
    await supabase.from("workflow_states").insert([
      {
        organization_id: organizationId,
        workflow_id: wfId,
        name: "Non répondu",
        category: "pending" as WorkflowCategory,
        is_initial: true,
        is_final: false,
      },
      {
        organization_id: organizationId,
        workflow_id: wfId,
        name: "En cours",
        category: "processing" as WorkflowCategory,
        is_initial: false,
        is_final: false,
      },
      {
        organization_id: organizationId,
        workflow_id: wfId,
        name: "Répondu",
        category: "processed" as WorkflowCategory,
        is_initial: false,
        is_final: true,
      },
    ]);
  }

  return result;
}

export async function updateWorkflow(
  workflowId: string,
  data: { name?: string; is_default?: boolean; type?: WorkflowType }
) {
  return supabase
    .from("workflows")
    .update(data)
    .eq("id", workflowId)
    .select()
    .single();
}

export async function deleteWorkflow(workflowId: string) {
  // Delete transitions and states first
  await supabase.from("workflow_transitions").delete().eq("workflow_id", workflowId);
  await supabase.from("workflow_states").delete().eq("workflow_id", workflowId);
  return supabase.from("workflows").delete().eq("id", workflowId);
}

export async function createState(
  organizationId: string,
  workflowId: string,
  data: { name: string; category: WorkflowCategory; is_initial?: boolean; is_final?: boolean; requires_signature?: boolean; is_send?: boolean }
) {
  return supabase
    .from("workflow_states")
    .insert({
      organization_id: organizationId,
      workflow_id: workflowId,
      name: data.name,
      category: data.category,
      is_initial: data.is_initial ?? false,
      is_final: data.is_final ?? false,
      requires_signature: data.requires_signature ?? false,
      is_send: data.is_send ?? false,
    })
    .select()
    .single();
}

export async function updateState(
  stateId: string,
  data: { name?: string; category?: WorkflowCategory; is_initial?: boolean; is_final?: boolean; requires_signature?: boolean; is_send?: boolean }
) {
  return supabase
    .from("workflow_states")
    .update(data)
    .eq("id", stateId)
    .select()
    .single();
}

export async function deleteState(stateId: string) {
  await supabase.from("workflow_transitions").delete().or(`from_state_id.eq.${stateId},to_state_id.eq.${stateId}`);
  return supabase.from("workflow_states").delete().eq("id", stateId);
}

export async function createTransition(
  organizationId: string,
  workflowId: string,
  fromStateId: string,
  toStateId: string,
  name?: string
) {
  return supabase
    .from("workflow_transitions")
    .insert({
      organization_id: organizationId,
      workflow_id: workflowId,
      from_state_id: fromStateId,
      to_state_id: toStateId,
      name: name ?? null,
    })
    .select()
    .single();
}

export async function deleteTransition(transitionId: string) {
  return supabase.from("workflow_transitions").delete().eq("id", transitionId);
}

export async function getAffectedCouriers(stateIds: string[]) {
  if (stateIds.length === 0) return { data: [], error: null };
  return supabase
    .from("couriers")
    .select("id, subject, workflow_state_id")
    .in("workflow_state_id", stateIds);
}

// Clear is_initial on all other states in a workflow
export async function clearInitialFlag(workflowId: string, exceptStateId: string) {
  return supabase
    .from("workflow_states")
    .update({ is_initial: false })
    .eq("workflow_id", workflowId)
    .neq("id", exceptStateId);
}

// Clear requires_signature on all other states in a workflow (only one allowed)
export async function clearSignatureFlag(workflowId: string, exceptStateId: string) {
  return supabase
    .from("workflow_states")
    .update({ requires_signature: false } as never)
    .eq("workflow_id", workflowId)
    .neq("id", exceptStateId);
}

// Clear is_send on all other states in a workflow (only one allowed)
export async function clearSendFlag(workflowId: string, exceptStateId: string) {
  return supabase
    .from("workflow_states")
    .update({ is_send: false } as never)
    .eq("workflow_id", workflowId)
    .neq("id", exceptStateId);
}
