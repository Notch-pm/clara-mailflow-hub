// D'où vient une démarche — et laquelle peut faire l'objet d'une demande.
//
// Logique PURE, testée par Vitest (src/test/socle/procedure-origin.test.ts) et
// partagée par chemin relatif entre l'écran (src/lib/procedure-origin.ts) et
// create-arpege-demande : le dialogue et le dépôt reconnaissent une démarche
// Arpège par la MÊME règle — Socle comprise (`partner`, public-api 1.35.0,
// recopié par sync-socle-referentiel dans external_reference_id +
// arpege_config_fields).
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

/**
 * Démarche partenaire dont l'interface est suspendue (ou absente) pour le
 * tenant : elle reste visible — l'agent doit comprendre pourquoi elle ne part
 * pas —, mais grisée. `partnerActive` vient de la RPC
 * `partner_integration_status` ; `undefined` (pas encore lu) ne grise rien.
 */
export function isPartnerSuspended(
  p: ProcedureOriginFields,
  partnerActive: boolean | undefined,
): boolean {
  return procedureOrigin(p) === "arpege" && partnerActive === false;
}

/** Une démarche qui n'est instruite nulle part ne peut plus être demandée. */
export function isRequestableProcedure(p: ProcedureOriginFields): boolean {
  return procedureOrigin(p) !== "local";
}

/**
 * Éditeur partenaire qui instruit la démarche hors de la gamme — affiché à
 * côté d'une action suggérée pour que l'agent sache que la demande part chez
 * un tiers. `null` pour une démarche instruite par Iris (le cas courant, qu'on
 * ne signale pas) ou instruite nulle part.
 */
export function procedurePartnerLabel(p: ProcedureOriginFields): string | null {
  return procedureOrigin(p) === "arpege" ? procedureOriginLabel(p) : null;
}
