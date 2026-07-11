// Construction de l'arbre des organisations miroir Socle.
// Port de buildOrgTree du Socle (src/features/superadmin/organizations/orgTree.ts),
// adapté aux colonnes miroir : la parenté se résout par socle_id / socle_parent_id.

import type { SocleOrgMirror } from "@/services/socleSyncService";

export type SocleOrgTreeNode<T extends SocleOrgMirror> = T & {
  children: SocleOrgTreeNode<T>[];
  depth: number;
};

export type SocleOrgNode = SocleOrgTreeNode<SocleOrgMirror>;

/**
 * Construit une forêt depuis la liste plate du miroir. Une org dont le parent
 * n'est pas dans l'ensemble (typiquement la racine du sous-arbre mappé) devient
 * une racine de la forêt affichée. Trié par nom à chaque niveau.
 * Générique : préserve les champs additionnels (ex. config Clara des orgs).
 */
export function buildSocleOrgTree<T extends SocleOrgMirror>(rows: T[]): SocleOrgTreeNode<T>[] {
  const bySocleId = new Map<string, SocleOrgTreeNode<T>>();
  for (const row of rows) bySocleId.set(row.socle_id, { ...row, children: [], depth: 1 });

  const roots: SocleOrgTreeNode<T>[] = [];
  for (const node of bySocleId.values()) {
    const parent = node.socle_parent_id ? bySocleId.get(node.socle_parent_id) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const assignDepth = (node: SocleOrgTreeNode<T>, depth: number) => {
    node.depth = depth;
    node.children.sort((a, b) => a.name.localeCompare(b.name));
    for (const child of node.children) assignDepth(child, depth + 1);
  };
  roots.sort((a, b) => a.name.localeCompare(b.name));
  for (const root of roots) assignDepth(root, 1);

  return roots;
}

/** Aplatit la forêt en liste ordonnée (parcours préfixe) — pour les sélecteurs indentés. */
export function flattenSocleOrgTree<T extends SocleOrgMirror>(
  nodes: SocleOrgTreeNode<T>[],
): SocleOrgTreeNode<T>[] {
  const result: SocleOrgTreeNode<T>[] = [];
  const walk = (list: SocleOrgTreeNode<T>[]) => {
    for (const n of list) {
      result.push(n);
      walk(n.children);
    }
  };
  walk(nodes);
  return result;
}
