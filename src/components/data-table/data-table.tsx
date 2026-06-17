import { useEffect, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getGroupedRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ExpandedState,
  type GroupingState,
  type SortingState,
  type Table as TanstackTable,
  type VisibilityState,
} from "@tanstack/react-table";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  /** Navigation au clic sur une ligne (n'interfère pas avec le tri/les colonnes, rendus hors TableBody). */
  onRowClick?: (row: TData) => void;
  getRowId?: (row: TData) => string;
  /** Expose l'instance table au parent (ex. pour construire l'export CSV depuis l'état tri/colonnes courant). */
  onTableInstanceChange?: (table: TanstackTable<TData>) => void;
  isLoading?: boolean;
  emptyMessage?: string;
}

/**
 * Tableau générique basé sur @tanstack/react-table, rendu avec les primitifs
 * shadcn existants (src/components/ui/table.tsx, inchangés). Gère le tri par
 * en-tête, la visibilité des colonnes et le groupement (sur une colonne à la
 * fois, piloté par DataTableGroupingSelect) ; pas de persistance d'état pour
 * le moment (relancé à chaque montage).
 */
export function DataTable<TData, TValue>({
  columns,
  data,
  onRowClick,
  getRowId,
  onTableInstanceChange,
  isLoading,
  emptyMessage = "Aucun résultat.",
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [grouping, setGrouping] = useState<GroupingState>([]);
  const [expanded, setExpanded] = useState<ExpandedState>(true);

  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnVisibility, grouping, expanded },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    onGroupingChange: setGrouping,
    onExpandedChange: setExpanded,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getGroupedRowModel: getGroupedRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    getRowId,
  });

  useEffect(() => {
    onTableInstanceChange?.(table);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, sorting, columnVisibility, grouping, expanded]);

  const rows = table.getRowModel().rows;
  const groupColumnId = grouping[0];
  const visibleColumnCount = table.getVisibleLeafColumns().length;

  return (
    <Card>
      {isLoading ? (
        <CardContent className="py-8 text-center text-muted-foreground">Chargement…</CardContent>
      ) : !rows.length ? (
        <CardContent className="py-8 text-center text-muted-foreground">{emptyMessage}</CardContent>
      ) : (
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              if (row.getIsGrouped()) {
                const label = groupColumnId ? String(row.getValue(groupColumnId) ?? "—") : "—";
                return (
                  <TableRow key={row.id} className="bg-muted/30 hover:bg-muted/40">
                    <TableCell colSpan={visibleColumnCount}>
                      <button
                        type="button"
                        onClick={row.getToggleExpandedHandler()}
                        className="w-full flex items-center gap-2 text-left"
                      >
                        {row.getIsExpanded() ? (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        )}
                        <span className="font-medium text-sm">{label}</span>
                        <Badge variant="secondary" className="ml-1">
                          {row.subRows.length}
                        </Badge>
                      </button>
                    </TableCell>
                  </TableRow>
                );
              }
              return (
                <TableRow
                  key={row.id}
                  className={cn(onRowClick && "cursor-pointer hover:bg-muted/50")}
                  onClick={() => onRowClick?.(row.original)}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                  ))}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}
