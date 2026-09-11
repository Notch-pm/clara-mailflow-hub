import { useEffect, useState, type ReactNode } from "react";
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
  type RowData,
  type SortingState,
  type Table as TanstackTable,
  type VisibilityState,
} from "@tanstack/react-table";
import { ChevronDown, ChevronRight } from "lucide-react";
import { LIST_HEADER_SURFACE } from "@/components/list/ListCells";
import { ListMessage } from "@/components/list/ListPage";
import { ListScrollArea } from "@/components/list/ListScrollArea";
import { useListDensity } from "@/hooks/useListDensity";
import { cn } from "@/lib/utils";
import type { CsvColumn } from "./csv-export";
import { ariaSort } from "./data-table-column-header";
import { DataTablePagination, type DataTablePaginationProps } from "./data-table-pagination";

declare module "@tanstack/react-table" {
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Nom de la colonne dans les menus « Colonnes » et « Grouper » ; à défaut, `exportLabel`. */
    label?: string;
    /** En-tête de la colonne dans l'export CSV. */
    exportLabel?: string;
    /**
     * Colonnes CSV supplémentaires. Une cellule qui montre deux informations
     * (objet + expéditeur) les exporte toutes les deux.
     */
    exportExtra?: CsvColumn<TData>[];
    /** Nom du groupement quand il diffère de la colonne (« Mois de réception »). */
    groupLabel?: string;
    /** Largeur fixe, en px. Sans elle, la colonne prend la place restante. */
    width?: number;
    /** Largeur plancher d'une colonne sans largeur fixe (défaut : 240). */
    minWidth?: number;
    align?: "left" | "right";
  }
}

/** Colonne du chevron « ouvrir », ajoutée quand les lignes sont cliquables. */
const CHEVRON_WIDTH = 40;
const DEFAULT_FLEX_WIDTH = 240;

const HEAD_CELL = cn(
  LIST_HEADER_SURFACE,
  "sticky top-0 z-10 h-[38px] whitespace-nowrap border-b px-3 text-left align-middle text-xs font-semibold text-muted-foreground first:pl-5 last:pr-5",
);
const BODY_CELL = "overflow-hidden border-b border-border/70 px-3 align-middle first:pl-5 last:pr-5";

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  /** Ouverture au clic (ou Entrée) sur une ligne. */
  onRowClick?: (row: TData) => void;
  getRowId?: (row: TData) => string;
  /**
   * Expose l'instance au parent (barre d'outils, export CSV). Passer le setter
   * de `useDataTableInstance` : il redessine le parent à chaque changement de
   * colonnes ou de groupement.
   */
  onTableInstanceChange?: (table: TanstackTable<TData>) => void;
  isLoading?: boolean;
  emptyMessage?: ReactNode;
  /**
   * Pagination SERVEUR : `data` ne contient qu'une page. On n'enregistre donc
   * pas `getPaginationRowModel`, qui découperait une seconde fois côté client.
   */
  pagination?: DataTablePaginationProps;
  /** Pied de liste à la place de la pagination numérotée (pages sans total, défilement infini). */
  footer?: ReactNode;
  /** Rendu sous les lignes, dans la zone qui défile (sentinelle de défilement infini). */
  bodyEnd?: ReactNode;
  /** Entité au singulier, pour le décompte des groupes (« 5 courriers »). */
  itemLabel?: string;
  /**
   * Remonte la liste en haut à chaque nouvelle valeur. Implicite avec
   * `pagination` (page + taille) ; à fournir avec un `footer` qui pagine.
   */
  resetScrollKey?: string | number;
  /** `false` : aucun en-tête triable (données triées par la source, pages sans tri). */
  sortable?: boolean;
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
 * Tableau générique basé sur @tanstack/react-table. Gère le tri par en-tête,
 * la visibilité des colonnes et le groupement (sur une colonne à la fois,
 * piloté par DataTableGroupingMenu) ; pas de persistance d'état pour le
 * moment (relancé à chaque montage).
 *
 * Il remplit la hauteur que lui laisse `ListPage` : l'en-tête reste collé,
 * seules les lignes défilent, la pagination reste en bas de l'écran. Il n'est
 * donc plus posé dans une carte — et surtout plus dans le `Table` de shadcn,
 * dont l'enveloppe `overflow-auto` créait une seconde zone de défilement et
 * empêchait l'en-tête de coller.
 *
 * Mise en page fixe (`table-fixed`) : chaque colonne déclare sa largeur
 * (`meta.width`), la colonne principale prend le reste. Les lignes gardent
 * ainsi une hauteur constante ; sous la largeur plancher, le tableau défile
 * horizontalement dans la même zone.
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
  footer,
  bodyEnd,
  // Même défaut que la pagination.
  itemLabel = pagination?.itemLabel ?? "courrier",
  resetScrollKey,
  sortable = true,
  sorting: controlledSorting,
  onSortingChange,
}: DataTableProps<TData, TValue>) {
  const { density } = useListDensity();
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
    enableSorting: sortable,
    // Groupée, la liste garde l'ordre de ses colonnes (la colonne groupée ne
    // passe pas en tête) et ses groupes restent ouverts : TanStack les
    // refermerait à chaque changement de groupement ou de page.
    groupedColumnMode: false,
    autoResetExpanded: false,
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
  const visibleColumns = table.getVisibleLeafColumns();
  const spanCount = visibleColumns.length + (onRowClick ? 1 : 0);
  // Largeur plancher : en dessous, défilement horizontal plutôt que colonnes écrasées.
  const minWidth =
    visibleColumns.reduce(
      (sum, column) => sum + (column.columnDef.meta?.width ?? column.columnDef.meta?.minWidth ?? DEFAULT_FLEX_WIDTH),
      0,
    ) + (onRowClick ? CHEVRON_WIDTH : 0);
  const rowHeight = density === "compact" ? "h-9" : "h-12";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ListScrollArea resetKey={pagination ? `${pagination.page}:${pagination.pageSize}` : resetScrollKey}>
        <table className="w-full table-fixed border-separate border-spacing-0 text-sm" style={{ minWidth }}>
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const meta = header.column.columnDef.meta;
                  return (
                    <th
                      key={header.id}
                      style={{ width: meta?.width }}
                      // Attribut omis sur une colonne non triable : « none » y
                      // annoncerait à tort une colonne triable mais non triée.
                      aria-sort={header.column.getCanSort() ? ariaSort(header.column.getIsSorted()) : undefined}
                      className={cn(HEAD_CELL, meta?.align === "right" && "text-right")}
                    >
                      {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                    </th>
                  );
                })}
                {onRowClick && (
                  <th style={{ width: CHEVRON_WIDTH }} className={HEAD_CELL}>
                    <span className="sr-only">Ouvrir</span>
                  </th>
                )}
              </tr>
            ))}
          </thead>
          {!isLoading && (
            <tbody>
              {rows.map((row) => {
                if (row.getIsGrouped()) {
                  const label = row.groupingValue == null || row.groupingValue === "" ? "—" : String(row.groupingValue);
                  const count = row.subRows.length;
                  return (
                    <tr key={row.id}>
                      {/* Collé sous l'en-tête : on sait toujours dans quel groupe on lit. */}
                      <td
                        colSpan={spanCount}
                        className="sticky top-[38px] z-[5] h-8 border-b bg-card bg-[linear-gradient(hsl(var(--muted)/0.85),hsl(var(--muted)/0.85))] p-0"
                      >
                        <button
                          type="button"
                          onClick={row.getToggleExpandedHandler()}
                          aria-expanded={row.getIsExpanded()}
                          className="flex h-8 w-full items-center gap-2 px-5 text-left"
                        >
                          {row.getIsExpanded() ? (
                            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                          )}
                          <span className="truncate text-[12.5px] font-bold text-foreground">{label}</span>
                          <span className="shrink-0 text-[11.5px] tabular-nums text-muted-foreground">
                            {count} {itemLabel}
                            {count > 1 ? "s" : ""}
                          </span>
                        </button>
                      </td>
                    </tr>
                  );
                }
                return (
                  <tr
                    key={row.id}
                    tabIndex={onRowClick ? 0 : undefined}
                    onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                    onKeyDown={
                      onRowClick
                        ? (e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              onRowClick(row.original);
                            }
                          }
                        : undefined
                    }
                    className={cn(
                      "bg-card",
                      onRowClick &&
                        "cursor-pointer transition-colors hover:bg-muted/55 focus-visible:bg-muted/55 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                    )}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td
                        key={cell.id}
                        className={cn(
                          BODY_CELL,
                          rowHeight,
                          cell.column.columnDef.meta?.align === "right" && "text-right",
                        )}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                    {onRowClick && (
                      <td aria-hidden="true" className={cn(BODY_CELL, rowHeight, "text-muted-foreground")}>
                        <ChevronRight className="ml-auto h-[15px] w-[15px]" />
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          )}
        </table>
        {isLoading ? (
          <ListMessage>Chargement…</ListMessage>
        ) : !rows.length ? (
          <ListMessage>{emptyMessage}</ListMessage>
        ) : null}
        {bodyEnd}
      </ListScrollArea>
      {/* Rendu même pendant le chargement et sur résultat vide : le total reste
          lisible et le contrôle ne saute pas sous le curseur. */}
      {pagination ? <DataTablePagination {...pagination} /> : footer}
    </div>
  );
}
