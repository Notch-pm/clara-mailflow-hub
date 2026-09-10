// Quelle organisation propose quelle démarche — lecture du miroir
// `procedure_organizations` (référentiel Socle, opt-in strict).
//
// Logique PURE, testée par Vitest (src/test/socle/procedure-activation.test.ts) :
// le dialogue de demande, l'écran Démarches et les tests partagent ces règles.
//
// Deux règles, et une seule exception assumée :
//   • une démarche du référentiel n'est proposée QUE par les organisations qui
//     l'ont activée (Iris refuse le dépôt sinon) ;
//   • une démarche que le référentiel ne connaît pas — démarche Arpège, embryon
//     local — n'a aucune ligne d'activation. La masquer partout fermerait le
//     flux partenaire : elle reste donc proposée quelle que soit l'organisation.

export interface ProcedureActivation {
  procedure_id: string;
  socle_organization_id: string;
}

/** Index démarche → organisations qui la proposent. */
export type ActivationIndex = Map<string, Set<string>>;

export function buildActivationIndex(activations: ProcedureActivation[]): ActivationIndex {
  const index: ActivationIndex = new Map();
  for (const a of activations) {
    if (!a?.procedure_id || !a?.socle_organization_id) continue;
    const set = index.get(a.procedure_id) ?? new Set<string>();
    set.add(a.socle_organization_id);
    index.set(a.procedure_id, set);
  }
  return index;
}

/**
 * `socleOrganizationId` à null = aucune organisation choisie : on ne filtre
 * rien (l'agent n'a pas encore dit à qui il s'adresse).
 */
export function isProcedureOfferedBy(
  index: ActivationIndex,
  procedureId: string,
  socleOrganizationId: string | null,
): boolean {
  const offering = index.get(procedureId);
  if (!offering || offering.size === 0) return true; // hors référentiel
  if (!socleOrganizationId) return true;
  return offering.has(socleOrganizationId);
}

export function filterProceduresForOrganization<T extends { id: string }>(
  procedures: T[],
  index: ActivationIndex,
  socleOrganizationId: string | null,
): T[] {
  return procedures.filter((p) => isProcedureOfferedBy(index, p.id, socleOrganizationId));
}

/** Organisations proposant une démarche, pour l'afficher (écran Démarches). */
export function organizationsOfferingProcedure(
  index: ActivationIndex,
  procedureId: string,
): string[] {
  return [...(index.get(procedureId) ?? [])];
}
