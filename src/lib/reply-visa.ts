/**
 * Sorties d'une étape de visa permises SANS visa — miroir côté écran du
 * trigger `couriers_enforce_visa` (migration 20261001140000_visa_reponses) :
 *
 * - le retour (transition `kind = 'previous'`, ou vers l'état initial) ;
 * - l'abandon (état final hors catégorie `processed` — « envoyer » sans visa
 *   reste interdit).
 *
 * Tout le reste est refusé par la base tant que l'étape n'est pas visée.
 * L'écran s'en sert pour ne pas proposer un bouton voué au refus ; la garde,
 * elle, reste au serveur.
 */
export function isFreeExitFromVisa(choice: {
  kind: "next" | "previous" | null;
  target: { is_initial: boolean | null; is_final: boolean | null; category: string | null };
}): boolean {
  if (choice.kind === "previous") return true;
  if (choice.target.is_initial) return true;
  return !!choice.target.is_final && choice.target.category !== "processed";
}
