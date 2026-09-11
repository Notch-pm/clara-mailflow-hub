import { useState } from "react";
import type { Table } from "@tanstack/react-table";
import { toast } from "sonner";
import { buildCsv, downloadCsv } from "@/components/data-table/csv-export";
import { tableCsvColumns } from "@/components/data-table/table-csv";
import {
  fetchAllCouriersForExport,
  type CourierListFilters,
  type CourierListRow,
} from "@/services/courierListService";

/**
 * Export CSV d'une liste de courriers : TOUT le jeu filtré, pas seulement la
 * page affichée, avec les colonnes visibles du tableau.
 *
 * `filters` doit être `list.filters` (cf. `useCourierList`) et non les filtres
 * bruts de la page : ceux-là portent le tri courant, le CSV sort donc dans
 * l'ordre affiché à l'écran.
 */
export function useCourierCsvExport(
  filters: CourierListFilters | null,
  table: Table<CourierListRow> | null,
  filePrefix: string,
) {
  const [isExporting, setIsExporting] = useState(false);

  async function exportCsv() {
    if (!filters || !table) return;
    setIsExporting(true);
    try {
      const { rows, truncated } = await fetchAllCouriersForExport(filters);
      const csv = buildCsv(rows, tableCsvColumns(table));
      downloadCsv(csv, `${filePrefix}-${new Date().toISOString().slice(0, 10)}.csv`);
      if (truncated) toast.warning("Export limité aux 20 000 premiers courriers.");
    } catch (e) {
      console.error(e);
      toast.error("Erreur lors de l'export du fichier.");
    } finally {
      setIsExporting(false);
    }
  }

  return { exportCsv, isExporting };
}
