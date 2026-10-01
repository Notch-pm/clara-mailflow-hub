/**
 * Proposition du service instructeur par l'analyse IA : ce que l'écran en fait.
 *
 * L'IA propose (`courier_analyses.suggested_socle_organization_id`), l'agent
 * décide — comme pour les tags proposés. Le geste dépend de là où en est le
 * courrier :
 * - aucune organisation : AFFECTER (simple, sans confirmation) ;
 * - une organisation, courrier encore à l'état initial : RÉAFFECTER (idem) ;
 * - une organisation, courrier en cours : TRANSFÉRER, par la confirmation de
 *   transfert existante — le courrier repart à l'état initial du workflow cible.
 */

export type ServiceSuggestionKind =
  /** Pas de proposition. */
  | "none"
  /** La proposition est l'organisation déjà désignée. */
  | "confirm"
  /** Proposée, mais hors de ce que l'agent peut choisir (droits, boîte IMAP, obsolète). */
  | "unavailable"
  | "assign"
  | "reassign"
  | "transfer";

export function serviceSuggestionKind(args: {
  suggestedId: string | null | undefined;
  currentId: string | null | undefined;
  isInitialState: boolean;
  /** Organisations proposables à l'affectation (`availableServices`). */
  assignableIds: readonly string[];
  /** Organisations proposables au transfert (`assignableOrgs` hors courante). */
  transferableIds: readonly string[];
}): ServiceSuggestionKind {
  const { suggestedId, currentId, isInitialState, assignableIds, transferableIds } = args;
  if (!suggestedId) return "none";
  if (currentId && suggestedId === currentId) return "confirm";
  if (!currentId || isInitialState) {
    if (!assignableIds.includes(suggestedId)) return "unavailable";
    return currentId ? "reassign" : "assign";
  }
  return transferableIds.includes(suggestedId) ? "transfer" : "unavailable";
}

/**
 * Organisation proposée par la PRÉ-SAISIE (`extract-courier-info`) → entrée de
 * la liste de l'écran. Par identifiant d'abord ; par nom pour une edge function
 * antérieure qui ne renvoyait que le nom. Une proposition hors de la liste
 * (organisation devenue obsolète entre-temps) est ignorée.
 */
export function findSuggestedOrg<T extends { id: string; name: string }>(
  result: { suggested_socle_organization_id?: string | null; suggested_service_name?: string | null },
  orgs: readonly T[],
): T | null {
  const id = result.suggested_socle_organization_id;
  if (id) return orgs.find((o) => o.id === id) ?? null;
  const name = result.suggested_service_name?.trim().toLowerCase();
  if (!name) return null;
  return orgs.find((o) => o.name.toLowerCase() === name) ?? null;
}
