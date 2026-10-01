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
