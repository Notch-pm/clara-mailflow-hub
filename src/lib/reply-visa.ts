/**
 * Sorties d'une étape de visa permises SANS visa — miroir côté écran du
 * trigger `couriers_enforce_visa` (migrations 20261001140000_visa_reponses,
 * 20261001193308_visa_renvoi_correction) :
 *
 * - le retour (transition `kind = 'previous'`, ou vers l'état initial) ;
 * - l'abandon (état final hors catégorie `processed` — « envoyer » sans visa
 *   reste interdit) ;
 * - le renvoi vers une étape dont le chemin NOMINAL (transitions `next`)
 *   ramène à ce visa — typiquement « À corriger » → « Pour visa ». La
 *   réponse repassera forcément par le visa : rien n'est contourné.
 *
 * Le chemin nominal seul, et non tout le graphe : depuis « Signature », une
 * transition secondaire vers « À corriger » ramène aussi au visa, mais la
 * suite nominale de la signature part vers l'envoi — c'est bien une avance.
 *
 * Tout le reste est refusé par la base tant que l'étape n'est pas visée.
 * L'écran s'en sert pour ne pas proposer un bouton voué au refus ; la garde,
 * elle, reste au serveur.
 */

export interface VisaGraphTransition {
  from_state_id: string;
  to_state_id: string;
  kind?: string | null;
}

/** La suite nominale (`next`) partie de `fromStateId` atteint-elle `visaStateId` ? */
export function nominalPathReaches(
  fromStateId: string,
  visaStateId: string,
  transitions: readonly VisaGraphTransition[],
): boolean {
  const seen = new Set<string>();
  const queue = [fromStateId];
  while (queue.length > 0) {
    const state = queue.shift()!;
    if (state === visaStateId) return true;
    if (seen.has(state)) continue;
    seen.add(state);
    for (const t of transitions) {
      if (t.from_state_id === state && t.kind === "next") queue.push(t.to_state_id);
    }
  }
  return false;
}

export function isFreeExitFromVisa(
  choice: {
    kind: "next" | "previous" | null;
    target: { id?: string; is_initial: boolean | null; is_final: boolean | null; category: string | null };
  },
  graph?: { visaStateId: string; transitions: readonly VisaGraphTransition[] },
): boolean {
  if (choice.kind === "previous") return true;
  if (choice.target.is_initial) return true;
  if (choice.target.is_final && choice.target.category !== "processed") return true;
  if (graph && choice.target.id) return nominalPathReaches(choice.target.id, graph.visaStateId, graph.transitions);
  return false;
}
