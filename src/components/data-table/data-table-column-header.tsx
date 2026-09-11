import type { HTMLAttributes } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { Column } from "@tanstack/react-table";
import { cn } from "@/lib/utils";

/** `false` = colonne non triée. Même convention que `column.getIsSorted()`. */
export type SortDirection = "asc" | "desc" | false;

/**
 * Valeur `aria-sort` du `<th>` correspondant.
 *
 * Sans elle, un lecteur d'écran annonce un bouton « Objet » sans dire dans quel
 * sens la liste est ordonnée. « none » signale une colonne triable mais non
 * triée — à ne pas confondre avec l'absence d'attribut, qui dit « non triable ».
 */
export function ariaSort(direction: SortDirection): "ascending" | "descending" | "none" {
  return direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none";
}

interface SortableHeaderProps {
  title: string;
  direction: SortDirection;
  onToggle: () => void;
  className?: string;
}

/**
 * En-tête cliquable, sans dépendance à @tanstack/react-table.
 *
 * Extrait de `DataTableColumnHeader` pour la boîte aux lettres, qui compose sa
 * propre liste (ligne « nouveau courrier », icônes de transfert) et n'a donc
 * pas d'objet `Column` à fournir. Les deux listes gardent ainsi le même
 * affordance visuel.
 */
export function SortableHeader({ title, direction, onToggle, className }: SortableHeaderProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "group/sort -ml-1.5 inline-flex h-7 max-w-full items-center gap-1 rounded-md px-1.5 text-xs font-semibold transition-colors hover:bg-muted hover:text-foreground",
        direction && "text-foreground",
        className,
      )}
    >
      <span className="truncate">{title}</span>
      {direction === "asc" ? (
        <ArrowUp className="h-3.5 w-3.5 shrink-0" />
      ) : direction === "desc" ? (
        <ArrowDown className="h-3.5 w-3.5 shrink-0" />
      ) : (
        <ArrowUpDown className="h-3.5 w-3.5 shrink-0 opacity-40 group-hover/sort:opacity-100" />
      )}
    </button>
  );
}

interface DataTableColumnHeaderProps<TData, TValue> extends HTMLAttributes<HTMLDivElement> {
  column: Column<TData, TValue>;
  title: string;
}

/** En-tête de colonne cliquable pour trier, pattern shadcn "Data Table". */
export function DataTableColumnHeader<TData, TValue>({
  column,
  title,
  className,
}: DataTableColumnHeaderProps<TData, TValue>) {
  if (!column.getCanSort()) {
    return <div className={cn("truncate", className)}>{title}</div>;
  }

  const sorted = column.getIsSorted();

  return (
    <SortableHeader
      title={title}
      direction={sorted}
      className={className}
      onToggle={() => {
        // Premier clic sur une colonne non triée : le sens vient de
        // `sortDescFirst`. Les colonnes de date le posent à `true` — proposer
        // les courriers les plus ANCIENS d'abord se lit comme un bug. Ensuite on
        // alterne simplement. On ne repasse jamais par « non trié » : en tri
        // serveur il n'existe pas d'ordre neutre, seulement un ordre implicite.
        if (sorted === false) column.toggleSorting(column.columnDef.sortDescFirst ?? false);
        else column.toggleSorting(sorted === "asc");
      }}
    />
  );
}
