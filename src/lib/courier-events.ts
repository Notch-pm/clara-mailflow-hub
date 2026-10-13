// Où journaliser le cycle de vie d'un sortant (`courier_events.courier_id`).
//
// Une réponse inscrit ses événements sur le courrier reçu auquel elle répond :
// c'est là que l'agent lit l'historique du dossier. Un sortant à l'initiative
// de la collectivité n'a pas de parent : il porte son propre historique. Sans
// ce repli, `logEvent` recevait `null` et avalait l'échec — la signature d'un
// tel courrier depuis l'espace élu ne laissait aucune trace.

/** Le courrier qui porte les événements d'un sortant : son parent, sinon lui-même. */
export function eventCourierIdOf(courier: { id: string; parent_courier_id?: string | null }): string {
  return courier.parent_courier_id ?? courier.id;
}

/** Variante pour les écrans qui ne tiennent que les deux identifiants. */
export function eventAnchor(parentCourierId: string | null | undefined, outboundId: string): string {
  return parentCourierId ?? outboundId;
}
