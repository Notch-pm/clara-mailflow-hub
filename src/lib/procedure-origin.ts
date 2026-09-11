// D'où vient une démarche — et laquelle peut faire l'objet d'une demande.
//
// Logique PURE, testée par Vitest (src/test/socle/procedure-origin.test.ts).
//
// Depuis la suppression de la « demande libre » (2026-09-11), une action de
// courrier EST une demande adressée à un système qui l'instruit : Iris pour les
// démarches du référentiel, le partenaire pour les démarches Arpège. Une
// démarche que personne n'instruit (embryon local resté sans origine) ne
// donnerait qu'un pense-bête sans suite : elle n'est plus proposée.

export type ProcedureOrigin = "arpege" | "iris" | "local";

/** Le peu qu'il faut connaître d'une démarche pour en situer l'origine. */
export interface ProcedureOriginFields {
  external_reference_id?: string | null;
  external_source?: string | null;
  arpege_config_fields?: unknown;
}

export function procedureOrigin(p: ProcedureOriginFields): ProcedureOrigin {
  // Les références Arpège survivent à l'adoption de la démarche par le Socle :
  // c'est leur présence EFFECTIVE, pas `external_source`, qui commande le flux.
  if ((p.external_reference_id && p.arpege_config_fields) || p.external_source === "arpege") {
    return "arpege";
  }
  if (p.external_source === "socle") return "iris";
  return "local";
}

/**
 * Origine affichée dans le sélecteur de démarches : le Socle est présenté sous
 * son nom produit « Iris », une démarche partenaire garde le nom du partenaire.
 */
export function procedureOriginLabel(p: ProcedureOriginFields): string | null {
  switch (procedureOrigin(p)) {
    case "arpege":
      return "Arpège";
    case "iris":
      return "Iris";
    default:
      return null;
  }
}

/** Une démarche qui n'est instruite nulle part ne peut plus être demandée. */
export function isRequestableProcedure(p: ProcedureOriginFields): boolean {
  return procedureOrigin(p) !== "local";
}
