import { ChevronDown, ListTree } from "lucide-react";
import type { Column, Table } from "@tanstack/react-table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ToolbarButton, ToolbarTooltip } from "@/components/list/ListPage";
import { columnLabel } from "./column-label";

const NONE = "__none__";

function groupLabel<TData>(column: Column<TData, unknown>): string {
  return column.columnDef.meta?.groupLabel ?? columnLabel(column);
}

interface DataTableGroupingMenuProps<TData> {
  table: Table<TData>;
}

/**
 * Bouton « Grouper » : regroupe les lignes affichées sur une colonne au choix.
 * Son libellé devient le groupement en vigueur, teinté, pour qu'on ne
 * l'oublie pas en lisant la liste.
 */
export function DataTableGroupingMenu<TData>({ table }: DataTableGroupingMenuProps<TData>) {
  const groupableColumns = table.getAllColumns().filter((c) => c.getCanGroup());
  const currentId = table.getState().grouping[0];
  const current = currentId ? groupableColumns.find((c) => c.id === currentId) : undefined;
  const label = current ? groupLabel(current) : "Grouper";

  if (!groupableColumns.length) return null;

  return (
    <DropdownMenu>
      <ToolbarTooltip label={current ? `Groupé par : ${label}` : "Grouper par"} hideFromXl>
        <DropdownMenuTrigger asChild>
          <ToolbarButton
            icon={<ListTree />}
            label={current ? `Grouper par : ${label}` : "Grouper"}
            text={label}
            showLabel
            active={!!current}
            className="xl:max-w-[180px]"
          >
            <ChevronDown className="hidden opacity-60 xl:block" />
          </ToolbarButton>
        </DropdownMenuTrigger>
      </ToolbarTooltip>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Grouper par</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={currentId ?? NONE}
          onValueChange={(v) => table.setGrouping(v === NONE ? [] : [v])}
        >
          <DropdownMenuRadioItem value={NONE}>Aucun</DropdownMenuRadioItem>
          {groupableColumns.map((column) => (
            <DropdownMenuRadioItem key={column.id} value={column.id}>
              {groupLabel(column)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
