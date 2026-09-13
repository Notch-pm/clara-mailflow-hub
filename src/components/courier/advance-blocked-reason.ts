/**
 * Pourquoi le bouton d'avancement nominal d'un courrier est grisé.
 *
 * L'écran ne constate qu'une chose — l'absence de transition « Suivante »
 * (`workflow_transitions.kind = 'next'`) depuis l'état courant — or elle a
 * **cinq** causes très différentes. N'en nommer qu'une (« affectez une
 * organisation gestionnaire ») envoie chercher le problème là où il n'est pas :
 * c'est ce qui a fait passer pour cassés les courriers de Seine Normandie
 * Agglomération le 2026-09-13, dont l'organisation était bien affectée et dont
 * le workflow n'avait simplement aucune transition marquée « Suivante » dans
 * l'éditeur.
 *
 * Le message dit aussi **où agir** : l'agent qui lit l'infobulle n'est pas
 * toujours celui qui configure les workflows.
 *
 * Module séparé du composant (et non exporté depuis lui) : `react-refresh`
 * n'accepte qu'un fichier n'exportant que des composants.
 */
export interface AdvanceBlockedContext {
  /** Le courrier a-t-il une organisation gestionnaire ? */
  hasOrganization: boolean;
  /** Cette organisation a-t-elle un workflow de courrier entrant ? */
  hasWorkflow: boolean;
  /** Le courrier est-il posé sur un état de ce workflow ? */
  hasState: boolean;
  isFinalState: boolean;
  /** Transitions sortantes de l'état courant, « Suivante » ou non. */
  transitionCount: number;
  /** Nom de l'état courant — peut manquer le temps de son chargement. */
  stateName?: string | null;
}

export function advanceBlockedReason(ctx: AdvanceBlockedContext): string {
  const state = ctx.stateName ? `« ${ctx.stateName} »` : "l'état courant";
  if (!ctx.hasOrganization) return "Affectez d'abord une organisation gestionnaire.";
  if (!ctx.hasWorkflow) {
    return "L'organisation gestionnaire n'a pas de workflow de courrier entrant.";
  }
  if (!ctx.hasState) {
    return "Ce courrier n'a aucun état de workflow. Réaffectez l'organisation gestionnaire pour le replacer au début.";
  }
  if (ctx.isFinalState) return `${state} est un état final : il n'y a pas d'étape suivante.`;
  if (ctx.transitionCount === 0) {
    return `Aucune transition ne part de ${state} dans ce workflow.`;
  }
  return `Aucune transition « Suivante » depuis ${state} : ce workflow n'a pas de chaîne nominale. Passez par « Autres actions », ou marquez une transition « Suivante » dans l'éditeur de workflow.`;
}
