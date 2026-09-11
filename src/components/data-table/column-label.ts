import type { Column } from "@tanstack/react-table";

/** Nom d'une colonne dans les menus — `meta.label`, sinon `meta.exportLabel`, sinon l'id. */
export function columnLabel<TData>(column: Column<TData, unknown>): string {
  const meta = column.columnDef.meta;
  return meta?.label ?? meta?.exportLabel ?? column.id;
}
