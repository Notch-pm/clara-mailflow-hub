// Répartition des tags appliqués à un courrier entre les deux groupes.
//
// Les tags appliqués sont stockés par NOM (`couriers.metadata->'tags'` est un
// tableau de chaînes) : le groupe se résout donc par rapprochement avec le
// référentiel de l'organisation, insensible à la casse.
//
// Logique PURE, testée par Vitest — la même règle vaut côté SQL dans
// `stats_tag_evolution`, y compris pour les orphelins.

import type { CourierTag, TagGroup } from "@/services/courierTagService";

export interface AppliedTag {
  /** Le nom tel qu'il est appliqué au courrier (fait foi pour l'affichage). */
  name: string;
  /** La fiche du référentiel, absente si le tag en a été retiré depuis. */
  tag: CourierTag | null;
}

export function indexTagsByName(tags: CourierTag[]): Map<string, CourierTag> {
  return new Map(tags.map((t) => [t.name.toLowerCase(), t]));
}

/**
 * Un nom que le référentiel ne connaît plus — tag supprimé après application —
 * compte en **thème**, comme il comptait avant l'existence des groupes. Le
 * ranger d'office en sentiment fausserait la courbe la plus lue.
 */
export function groupOfAppliedTag(name: string, index: Map<string, CourierTag>): TagGroup {
  return index.get(name.toLowerCase())?.tag_group ?? "theme";
}

export function splitAppliedTags(
  names: string[],
  tags: CourierTag[],
): Record<TagGroup, AppliedTag[]> {
  const index = indexTagsByName(tags);
  const out: Record<TagGroup, AppliedTag[]> = { theme: [], sentiment: [] };
  for (const name of names) {
    const tag = index.get(name.toLowerCase()) ?? null;
    out[tag?.tag_group ?? "theme"].push({ name, tag });
  }
  return out;
}

/** Tags du référentiel d'un groupe, triés par nom (ordre de la palette pour un sentiment). */
export function tagsOfGroup(tags: CourierTag[], group: TagGroup): CourierTag[] {
  return tags.filter((t) => t.tag_group === group);
}
