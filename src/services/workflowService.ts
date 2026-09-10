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

export async function deleteState(stateId: string, reassignToStateId?: string | null) {
  // Reassign couriers currently using this state to the fallback state (typically the workflow's initial state).
  if (reassignToStateId) {
    await supabase
      .from("couriers")
      .update({ workflow_state_id: reassignToStateId } as never)
      .eq("workflow_state_id", stateId);
  } else {
    // Detach to avoid FK violations if no fallback was provided.
    await supabase
      .from("couriers")
      .update({ workflow_state_id: null } as never)
      .eq("workflow_state_id", stateId);
  }
  await supabase.from("workflow_transitions").delete().or(`from_state_id.eq.${stateId},to_state_id.eq.${stateId}`);
  return supabase.from("workflow_states").delete().eq("id", stateId);
}

export type TransitionKind = "next" | "previous" | null;

export async function createTransition(
  organizationId: string,
  workflowId: string,
  fromStateId: string,
  toStateId: string,
  name?: string,
  kind?: TransitionKind,
) {
  // Enforce single 'next'/'previous' per source state by clearing the previous holder.
  if (kind) {
    await supabase
      .from("workflow_transitions")
      .update({ kind: null } as never)
      .eq("from_state_id", fromStateId)
      .eq("kind", kind);
  }
  return supabase
    .from("workflow_transitions")
    .insert({
      organization_id: organizationId,
      workflow_id: workflowId,
      from_state_id: fromStateId,
      to_state_id: toStateId,
      name: name ?? null,
      kind: kind ?? null,
    } as never)
    .select()
    .single();
}

export async function updateTransition(
  transitionId: string,
  data: { name?: string | null; kind?: TransitionKind },
) {
  // Enforce single 'next'/'previous' per source state.
  if (data.kind) {
    const { data: current } = await supabase
      .from("workflow_transitions")
      .select("from_state_id")
      .eq("id", transitionId)
      .single();
    if (current?.from_state_id) {
      await supabase
        .from("workflow_transitions")
        .update({ kind: null } as never)
        .eq("from_state_id", current.from_state_id)
        .eq("kind", data.kind)
        .neq("id", transitionId);
    }
  }
  return supabase
    .from("workflow_transitions")
    .update(data as never)
    .eq("id", transitionId)
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

export type WorkflowChainState = {
  id: string;
  name: string;
  category: WorkflowCategory;
  is_initial: boolean | null;
  is_final: boolean | null;
};

/**
 * Chaîne nominale d'un workflow : on part de l'état initial et on suit les
 * transitions marquées « next ». Un workflow reste un graphe — cette lecture
 * linéaire ne sert qu'à dessiner une frise d'avancement ; les états atteignables
 * uniquement par une transition secondaire n'y figurent pas.
 */
export async function getWorkflowStateChain(workflowId: string): Promise<WorkflowChainState[]> {
  const [{ data: states, error: statesError }, { data: transitions, error: transitionsError }] =
    await Promise.all([
      supabase
        .from("workflow_states")
        .select("id, name, category, is_initial, is_final")
        .eq("workflow_id", workflowId),
      supabase
        .from("workflow_transitions")
        .select("from_state_id, to_state_id, kind")
        .eq("workflow_id", workflowId)
        .eq("kind", "next"),
    ]);
  if (statesError) throw statesError;
  if (transitionsError) throw transitionsError;

  const byId = new Map((states ?? []).map((s) => [s.id, s as WorkflowChainState]));
  const nextOf = new Map(
    (transitions ?? []).map((t) => [t.from_state_id as string, t.to_state_id as string]),
  );

  const start = (states ?? []).find((s) => s.is_initial) ?? (states ?? [])[0];
  if (!start) return [];

  const chain: WorkflowChainState[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined = start.id;
  // Garde-fou : un workflow mal configuré peut boucler sur lui-même.
  while (cursor && !seen.has(cursor)) {
    const state = byId.get(cursor);
    if (!state) break;
    seen.add(cursor);
    chain.push(state);
    cursor = nextOf.get(cursor);
  }
  return chain;
}
