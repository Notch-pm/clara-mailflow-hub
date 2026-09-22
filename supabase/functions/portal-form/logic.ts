// Logique pure (testable en Vitest) de portal-form : les consentements RGPD
// demandés à l'usager au dépôt public.
//
// Le formulaire portail est le seul endroit de Clara où l'usager est PRÉSENT
// au moment du dépôt : c'est là que la question se pose, comme au dépôt Iris.
// Le GET sert les phrases composées côté serveur (nom de l'organisation
// interpolé) ; le POST les recompose avec la même fonction et le même nom :
// la phrase consignée est, à la lettre, celle qui a été affichée.

import {
  CONSENTS,
  consentStatement,
  isConsentKind,
  type ConsentKind,
} from "../_shared/consents/catalog.ts";

export interface PortalConsentConfig {
  kind: ConsentKind;
  required: boolean;
  default_granted: boolean;
  /** Phrase EXACTE à afficher — et à consigner telle quelle. */
  statement: string;
}

/** Ce que le GET `?token=` sert au navigateur pour rendre les deux cases. */
export function portalConsentsConfig(organismName: string | null | undefined): PortalConsentConfig[] {
  return CONSENTS.map((c) => ({
    kind: c.kind,
    required: c.required,
    default_granted: c.defaultGranted,
    statement: consentStatement(c.kind, organismName),
  }));
}

/** Nom du champ multipart pour un consentement : `consent_traitement`, `consent_partage`. */
export function portalConsentField(kind: ConsentKind): string {
  return `consent_${kind}`;
}

/**
 * Réponses lues du multipart : `"true"` vaut accord, toute autre valeur vaut
 * refus, un champ ABSENT n'est pas transmis — c'est `normalizeConsents` qui
 * décide ensuite (absent = refus, et l'obligatoire absent = 400). Aucune
 * phrase n'est lue du client.
 */
export function portalConsentAnswersFromForm(
  get: (field: string) => string | null | undefined,
): { kind: ConsentKind; granted: boolean }[] {
  const out: { kind: ConsentKind; granted: boolean }[] = [];
  for (const c of CONSENTS) {
    const raw = get(portalConsentField(c.kind));
    if (raw === null || raw === undefined) continue;
    if (!isConsentKind(c.kind)) continue;
    out.push({ kind: c.kind, granted: String(raw).trim().toLowerCase() === "true" });
  }
  return out;
}
