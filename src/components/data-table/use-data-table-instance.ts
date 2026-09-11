import { useCallback, useState } from "react";
import type { Table as TanstackTable } from "@tanstack/react-table";

/**
 * Instance de la `DataTable`, pour les commandes posées HORS du tableau (barre
 * d'outils : grouper, colonnes, export).
 *
 * L'instance TanStack est un objet stable : la ranger telle quelle dans un
 * `useState` ne redessinait pas le parent quand le groupement ou les colonnes
 * changeaient — `setState` ignore une valeur identique —, et les menus de la
 * barre d'outils affichaient l'état précédent. On range donc une enveloppe
 * neuve à chaque notification de la table.
 */
export function useDataTableInstance<TData>() {
  const [snapshot, setSnapshot] = useState<{ table: TanstackTable<TData> } | null>(null);
  const onTableInstanceChange = useCallback((table: TanstackTable<TData>) => setSnapshot({ table }), []);
  return [snapshot?.table ?? null, onTableInstanceChange] as const;
}
