import type { Table } from "@tanstack/react-table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const NONE = "__none__";

/** Libellé d'affichage d'une colonne — défini via meta.exportLabel, sinon l'id. */
function columnLabel<TData>(column: ReturnType<Table<TData>["getAllColumns"]>[number]): string {
  return (column.columnDef.meta as { exportLabel?: string } | undefined)?.exportLabel ?? column.id;
}

interface DataTableGroupingSelectProps<TData> {
  table: Table<TData>;
}

/** Sélecteur "Grouper par" : regroupe les lignes sur une colonne au choix (ou aucune). */
export function DataTableGroupingSelect<TData>({ table }: DataTableGroupingSelectProps<TData>) {
  const groupableColumns = table.getAllColumns().filter((c) => c.getCanGroup());
  const current = table.getState().grouping[0] ?? NONE;

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-sm text-muted-foreground whitespace-nowrap">Grouper par</span>
      <Select value={current} onValueChange={(v) => table.setGrouping(v === NONE ? [] : [v])}>
        <SelectTrigger className="w-[160px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>Aucun</SelectItem>
          {groupableColumns.map((column) => (
            <SelectItem key={column.id} value={column.id}>
              {columnLabel(column)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
