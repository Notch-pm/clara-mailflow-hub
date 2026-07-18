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
import { ariaSort } from "./data-table-column-header";
import { DataTablePagination, type DataTablePaginationProps } from "./data-table-pagination";

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
  /**
   * Pagination SERVEUR : `data` ne contient qu'une page. On n'enregistre donc
   * pas `getPaginationRowModel`, qui découperait une seconde fois côté client.
   */
  pagination?: DataTablePaginationProps;
  /**
   * Tri contrôlé par le parent. Sa PRÉSENCE bascule la table en tri manuel :
   * les lignes sont rendues dans l'ordre reçu, à charge pour le parent (donc
   * pour le serveur) de les trier. Indispensable dès qu'il y a pagination
   * serveur — voir le commentaire du composant.
   */
  sorting?: SortingState;
  onSortingChange?: (sorting: SortingState) => void;
}

/**
 * Tableau générique basé sur @tanstack/react-table, rendu avec les primitifs
 * shadcn existants (src/components/ui/table.tsx, inchangés). Gère le tri par
 * en-tête, la visibilité des colonnes et le groupement (sur une colonne à la
 * fois, piloté par DataTableGroupingSelect) ; pas de persistance d'état pour
 * le moment (relancé à chaque montage).
 *
 * Deux modes de tri :
 *
 * - **Local** (aucune prop `sorting`) : la table trie `data` elle-même. Convient
 *   aux tableaux non paginés, qui détiennent l'intégralité des lignes.
 * - **Manuel** (prop `sorting` fournie) : la table n'ordonne rien et se contente
 *   de refléter le sens dans les en-têtes. C'est le mode à utiliser avec
 *   `pagination`, où `data` ne contient qu'une page : trier localement ne
 *   porterait que sur les lignes affichées tout en laissant croire à un tri
 *   global. Les pages y déclarent `enableSorting: false` sur les colonnes que le
 *   serveur ne sait pas trier, plutôt que de promettre ce qu'elles ne tiendront pas.
 *
 * Le groupement, lui, reste local à `data` dans les deux cas.
 */
export function DataTable<TData, TValue>({
  columns,
  data,
  onRowClick,
  getRowId,
  onTableInstanceChange,
  isLoading,
  emptyMessage = "Aucun résultat.",
  pagination,
  sorting: controlledSorting,
  onSortingChange,
}: DataTableProps<TData, TValue>) {
  const [internalSorting, setInternalSorting] = useState<SortingState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [grouping, setGrouping] = useState<GroupingState>([]);
  const [expanded, setExpanded] = useState<ExpandedState>(true);

  const isManualSorting = controlledSorting !== undefined;
  const sorting = controlledSorting ?? internalSorting;

  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnVisibility, grouping, expanded },
    onSortingChange: (updater) => {
      const next = typeof updater === "function" ? updater(sorting) : updater;
      (onSortingChange ?? setInternalSorting)(next);
    },
    onColumnVisibilityChange: setColumnVisibility,
    onGroupingChange: setGrouping,
    onExpandedChange: setExpanded,
    manualSorting: isManualSorting,
    // En tri serveur, « pas de tri » n'existe pas : sans ordre explicite les
    // pages se recouvriraient. On empêche donc le cycle de repasser par cet état.
    enableSortingRemoval: !isManualSorting,
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
                  <TableHead
                    key={header.id}
                    // Attribut omis sur une colonne non triable : « none » y
                    // annoncerait à tort une colonne triable mais non triée.
                    aria-sort={
                      header.column.getCanSort() ? ariaSort(header.column.getIsSorted()) : undefined
                    }
                  >
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
      {/* Rendu même pendant le chargement et sur résultat vide : le total reste
          lisible et le contrôle ne saute pas sous le curseur. */}
      {pagination && <DataTablePagination {...pagination} />}
    </Card>
  );
}
