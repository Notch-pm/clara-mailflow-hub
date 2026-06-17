import { Columns3 } from "lucide-react";
import type { Table } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** Libellé d'export/affichage d'une colonne — défini via meta.exportLabel, sinon l'id. */
function columnLabel<TData>(column: ReturnType<Table<TData>["getAllColumns"]>[number]): string {
  return (column.columnDef.meta as { exportLabel?: string } | undefined)?.exportLabel ?? column.id;
}

interface DataTableColumnToggleProps<TData> {
  table: Table<TData>;
}

/** Bouton "Colonnes" : menu déroulant pour afficher/masquer les colonnes masquables. */
export function DataTableColumnToggle<TData>({ table }: DataTableColumnToggleProps<TData>) {
  const hideableColumns = table.getAllColumns().filter((c) => c.getCanHide());

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Columns3 className="h-4 w-4" />
          Colonnes
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>Colonnes affichées</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {hideableColumns.map((column) => (
          <DropdownMenuCheckboxItem
            key={column.id}
            checked={column.getIsVisible()}
            onCheckedChange={(value) => column.toggleVisibility(!!value)}
            onSelect={(e) => e.preventDefault()}
          >
            {columnLabel(column)}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
