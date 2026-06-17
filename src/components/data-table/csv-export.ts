/**
 * Génération de CSV exploitables sous Excel, à partir des lignes/colonnes
 * actuellement visibles d'une DataTable. Logique pure, sans dépendance
 * React/Supabase ni à @tanstack/react-table, pour rester facilement testable.
 */

/** Séparateur de champs recommandé pour une ouverture correcte dans Excel FR. */
export const CSV_DELIMITER = ";";

/** Échappe une valeur pour insertion dans une cellule CSV (RFC 4180). */
export function escapeCsvValue(value: unknown, delimiter: string = CSV_DELIMITER): string {
  const str = value == null ? "" : String(value);
  const needsQuoting = str.includes(delimiter) || str.includes('"') || str.includes("\n") || str.includes("\r");
  if (!needsQuoting) return str;
  return `"${str.replace(/"/g, '""')}"`;
}

export interface CsvColumn<T> {
  header: string;
  accessor: (row: T) => unknown;
}

/** Construit le contenu CSV complet (en-têtes + lignes) à partir de colonnes définies. */
export function buildCsv<T>(rows: T[], columns: CsvColumn<T>[], delimiter: string = CSV_DELIMITER): string {
  const headerLine = columns.map((c) => escapeCsvValue(c.header, delimiter)).join(delimiter);
  const lines = rows.map((row) => columns.map((c) => escapeCsvValue(c.accessor(row), delimiter)).join(delimiter));
  return [headerLine, ...lines].join("\r\n");
}

/**
 * Déclenche le téléchargement navigateur d'un CSV. Préfixe un BOM UTF-8 pour
 * qu'Excel (notamment en FR) affiche correctement les caractères accentués
 * à l'ouverture directe du fichier (double-clic), sans import manuel.
 */
export function downloadCsv(csvContent: string, filename: string) {
  const BOM = String.fromCharCode(0xfeff);
  const blob = new Blob([BOM + csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
