import type { ArpegeFormComponent } from "@/services/procedureService";

/** Champs « demandeur » Arpège réellement affichés (ConfigInfoUsagerObligs). */
export const ARPEGE_DEMANDEUR_CODES = [
  "CIVILITE", "NOM_USUEL", "NOM_NAISSANCE", "PRENOMS",
  "DATE_NAISSANCE", "EMAIL", "TEL_FIXE", "TEL_MOBILE",
];

export interface FlatComponent {
  component: ArpegeFormComponent;
  groupLabel?: string;
}

export type IdentiteValue = {
  CodeCivilite: string;
  NomUsage: string;
  NomNaissance: string;
  Prenoms: string;
};

export function flattenComponents(
  components: ArpegeFormComponent[],
  groupLabel?: string,
): FlatComponent[] {
  const result: FlatComponent[] = [];
  // If this level contains a Pieces_jointes, sibling leaf fields are auxiliary
  // (e.g. a title/description Texte added by Arpège alongside the upload slot)
  // and should be skipped to avoid spurious text inputs.
  const levelHasPJ = components.some((c) => c.Type === "Pieces_jointes");

  for (const c of components) {
    if (c.Type === "Bloc") {
      result.push(...flattenComponents(c.Components ?? [], c.Libelle || groupLabel));
    } else if (c.Type === "Pieces_jointes") {
      result.push({ component: c, groupLabel });
    } else if (!levelHasPJ && c.Type !== "Label_long") {
      result.push({ component: c, groupLabel });
    }
  }
  return result;
}

export function isRequired(c: ArpegeFormComponent): boolean {
  return !c.Libelle?.includes("(facultatif)");
}

export function getOptions(c: ArpegeFormComponent): Array<{ code: string; label: string }> {
  if (!Array.isArray(c.Value) || c.Value.length === 0) return [];
  return (c.Value as Array<Record<string, string>>).map((v) => ({
    code: v.Code ?? v.code ?? String(v),
    label: v.Libelle ?? v.libelle ?? v.Label ?? v.Code ?? String(v),
  }));
}

/** Regroupe les champs consécutifs partageant le même libellé de bloc. */
export function groupByLabel(
  flat: FlatComponent[],
): Array<{ label?: string; items: FlatComponent[] }> {
  const groups: Array<{ label?: string; items: FlatComponent[] }> = [];
  for (const item of flat) {
    const last = groups[groups.length - 1];
    if (!last || last.label !== item.groupLabel) {
      groups.push({ label: item.groupLabel, items: [item] });
    } else {
      last.items.push(item);
    }
  }
  return groups;
}

export function buildFormValues(
  components: ArpegeFormComponent[],
  values: Record<string, unknown>,
): Array<{ id: string; valeur: unknown }> {
  return flattenComponents(components)
    .filter(({ component: c }) => c.Type !== "Pieces_jointes")
    .map(({ component: c }) => ({ id: c.DataId, valeur: values[c.DataId] ?? null }))
    .filter((e) => e.valeur !== null && e.valeur !== "");
}

/**
 * Valeurs proposées par l'analyse pour le formulaire métier, réduites aux
 * champs que ce formulaire saisit réellement (ni pièce jointe, ni identité) :
 * un `DataId` inconnu — schéma Arpège changé depuis l'analyse — est ignoré.
 */
export function arpegeBusinessPrefill(
  components: ArpegeFormComponent[],
  prefill: Record<string, string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const { component: c } of flattenComponents(components)) {
    if (c.Type === "Pieces_jointes" || c.Type === "Identite") continue;
    const value = prefill[c.DataId];
    if (typeof value === "string" && value.trim()) out[c.DataId] = value;
  }
  return out;
}

export function businessRequiredMet(
  components: ArpegeFormComponent[],
  values: Record<string, unknown>,
  piecesJointes: Record<string, string[]>,
): boolean {
  return flattenComponents(components)
    .filter(({ component: c }) => isRequired(c))
    .every(({ component: c }) => {
      if (c.Type === "Pieces_jointes") {
        return (piecesJointes[c.DataId]?.length ?? 0) > 0;
      }
      if (c.Type === "Identite") {
        const id = values[c.DataId] as IdentiteValue | undefined;
        return !!(id && (id.NomUsage || id.NomNaissance) && id.Prenoms);
      }
      const v = values[c.DataId];
      return v !== undefined && v !== null && String(v).trim().length > 0;
    });
}

/** Les champs « demandeur » obligatoires affichés sont-ils tous renseignés ? */
export function demandeurRequiredMet(
  fields: Array<{ Code: string; Obligatoire?: boolean }>,
  values: Record<string, string>,
): boolean {
  return fields
    .filter((f) => f.Obligatoire && ARPEGE_DEMANDEUR_CODES.includes(f.Code))
    .every((f) => (values[f.Code] ?? "").trim().length > 0);
}
