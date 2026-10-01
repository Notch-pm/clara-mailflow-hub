import { supabase } from "@/integrations/supabase/client";

/**
 * Lectures propres au tableau de bord. Les courriers eux-mêmes viennent du RPC
 * `mailroom_couriers` (`mailroomService`), les files du parapheur des hooks élu.
 */

/** Organisations (miroir Socle) dont l'utilisateur est membre — y compris s'il est administrateur. */
export async function listMySocleOrganizationIds(userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("socle_organization_members")
    .select("socle_organization_id")
    .eq("user_id", userId);
  if (error) throw error;
  return ((data ?? []) as { socle_organization_id: string | null }[])
    .map((r) => r.socle_organization_id)
    .filter((id): id is string => !!id);
}

/**
 * Réponses que l'utilisateur a commencées et qui sont encore à l'état initial
 * de leur circuit (« En rédaction ») : ni soumises au visa, ni à la signature.
 */
export async function countMyDraftReplies(organizationId: string, userId: string): Promise<number> {
  const { data: initialStates, error: statesError } = await supabase
    .from("workflow_states")
    .select("id")
    .eq("is_initial", true);
  if (statesError) throw statesError;
  const stateIds = (initialStates ?? []).map((s) => s.id);
  if (!stateIds.length) return 0;

  const { count, error } = await supabase
    .from("couriers")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("direction", "outbound")
    .eq("created_by", userId)
    .not("parent_courier_id", "is", null)
    .is("deleted_at", null)
    .in("workflow_state_id", stateIds);
  if (error) throw error;
  return count ?? 0;
}

/** Noms des états de workflow de l'organisation (RLS via `x-org-id`), pour la colonne « Étape ». */
export async function listWorkflowStateNames(): Promise<Map<string, string>> {
  const { data, error } = await supabase.from("workflow_states").select("id, name");
  if (error) throw error;
  return new Map((data ?? []).map((s) => [s.id, s.name]));
}
