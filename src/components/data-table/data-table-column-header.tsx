import type { HTMLAttributes } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { Column } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
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
 * propre `<Table>` (ligne « nouveau courrier », icônes de transfert) et n'a donc
 * pas d'objet `Column` à fournir. Les deux tableaux gardent ainsi le même
 * affordance visuel.
 */
export function SortableHeader({ title, direction, onToggle, className }: SortableHeaderProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn("-ml-3 h-8 data-[state=open]:bg-accent", className)}
      onClick={onToggle}
    >
      <span>{title}</span>
      {direction === "asc" ? (
        <ArrowUp className="ml-2 h-4 w-4" />
      ) : direction === "desc" ? (
        <ArrowDown className="ml-2 h-4 w-4" />
      ) : (
        <ArrowUpDown className="ml-2 h-4 w-4 text-muted-foreground" />
      )}
    </Button>
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
    return <div className={cn(className)}>{title}</div>;
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
