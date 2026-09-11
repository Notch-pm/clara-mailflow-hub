import { Columns3 } from "lucide-react";
import type { Table } from "@tanstack/react-table";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ToolbarButton, ToolbarTooltip } from "@/components/list/ListPage";
import { columnLabel } from "./column-label";

interface DataTableColumnToggleProps<TData> {
  table: Table<TData>;
}

/** Bouton « Colonnes » : menu déroulant pour afficher/masquer les colonnes masquables. */
export function DataTableColumnToggle<TData>({ table }: DataTableColumnToggleProps<TData>) {
  const hideableColumns = table.getAllColumns().filter((c) => c.getCanHide());

  return (
    <DropdownMenu>
      <ToolbarTooltip label="Colonnes">
        <DropdownMenuTrigger asChild>
          <ToolbarButton icon={<Columns3 />} label="Colonnes" className="max-sm:hidden" />
        </DropdownMenuTrigger>
      </ToolbarTooltip>
      <DropdownMenuContent align="end" className="w-52">
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
