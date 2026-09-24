// Quand un courrier accepte-t-il qu'on lui crée une action liée ou une réponse ?
// LOGIQUE PURE (aucune dépendance Deno), partagée par l'écran (boutons « Créer »)
// et par les edge functions, testée par vitest.
//
// LA RÈGLE (2026-09-24) : ni action ni réponse tant que le courrier
//   • n'a pas d'organisation gestionnaire (`socle_organization_id` nul), ou
//   • est encore dans la boîte aux lettres — état initial de son workflow, ou
//     aucun état (`workflow_state_id` nul, organisation sans workflow).
// Le courrier doit d'abord être orienté, puis pris en charge.
//
// ⚠️ LE TRIGGER `enforce_courier_creation_guard` (migration
// 20260924190000_garde_creation_action_reponse.sql) applique la même règle en
// base, pour tout appelant, avec les MÊMES messages. Changer l'un sans l'autre
// ferait dire à l'écran autre chose que ce que la base refuse.

export const NO_MANAGING_ORG_REASON =
  "Ce courrier n'a pas d'organisation gestionnaire : désignez-la avant de créer une action ou une réponse.";

export const IN_MAILBOX_REASON =
  "Ce courrier est encore dans la boîte aux lettres : faites-le avancer dans son workflow avant de créer une action ou une réponse.";

export interface CourierCreationState {
  socleOrganizationId: string | null | undefined;
  workflowStateId: string | null | undefined;
  /**
   * `workflow_states.is_initial` de l'état courant. `null` vaut « pas initial »,
   * comme dans la boîte aux lettres ; `undefined` = pas encore connu (ou état
   * introuvable).
   */
  stateIsInitial: boolean | null | undefined;
}

/**
 * Le motif du refus, ou `null` si la création est permise.
 *
 * Un état dont on ne sait pas encore s'il est initial compte comme la boîte aux
 * lettres : le bouton reste grisé une fraction de seconde plutôt que de
 * s'ouvrir sur un refus de la base.
 */
export function courierCreationBlockReason(c: CourierCreationState): string | null {
  if (!c.socleOrganizationId) return NO_MANAGING_ORG_REASON;
  if (!c.workflowStateId || c.stateIsInitial === undefined || c.stateIsInitial === true) {
    return IN_MAILBOX_REASON;
  }
  return null;
}
