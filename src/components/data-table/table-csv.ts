import type { Table } from "@tanstack/react-table";
import type { CsvColumn } from "./csv-export";

/**
 * Colonnes CSV d'après les colonnes AFFICHÉES du tableau : ce qui est exporté
 * est ce qui est à l'écran. Une colonne qui montre deux informations
 * (`meta.exportExtra` — objet + expéditeur) les exporte toutes les deux.
 */
export function tableCsvColumns<TData>(table: Table<TData>): CsvColumn<TData>[] {
  return table.getVisibleLeafColumns().flatMap((column) => {
    const meta = column.columnDef.meta;
    const own: CsvColumn<TData> = {
      header: meta?.exportLabel ?? column.id,
      accessor: (row) => column.accessorFn?.(row, 0) ?? "",
    };
    return [own, ...(meta?.exportExtra ?? [])];
  });
}
