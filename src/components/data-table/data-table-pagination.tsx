import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
} from "@/components/ui/pagination";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ListFooter } from "@/components/list/ListPage";
import { cn } from "@/lib/utils";

// PaginationPrevious / PaginationNext ne sont pas utilisés : ces primitives
// shadcn embarquent « Previous » / « Next » en dur, alors que l'application est
// entièrement en français. On compose sur PaginationLink plutôt que de modifier
// un fichier vendoré de ui/, qu'une régénération écraserait.

export const PAGE_SIZE_OPTIONS = [25, 50, 100, 200] as const;

export interface DataTablePaginationProps {
  /** Index de page, base 0. */
  page: number;
  pageCount: number;
  pageSize: number;
  totalCount: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  isLoading?: boolean;
  /** Nom de l'entité au singulier, pour le libellé (« 1 247 courriers »). */
  itemLabel?: string;
}

/**
 * Fenêtre de pages à afficher : première, dernière, et ±1 autour de la page
 * courante, séparées par des ellipses. `-1` représente une ellipse.
 *
 * Exporté pour être testé unitairement — les fenêtres de pagination sont un
 * nid à erreurs de bornes.
 */
export function getPageWindow(rawPage: number, pageCount: number): number[] {
  if (pageCount <= 0) return [];
  // useCourierList recale la page quand elle dépasse le nombre de pages, mais un
  // rendu s'intercale entre l'arrivée des données et cet effet : la fonction doit
  // rester totale plutôt que de produire un numéro hors bornes.
  const page = Math.min(Math.max(rawPage, 0), pageCount - 1);

  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i);

  const pages = new Set<number>([0, pageCount - 1, page]);
  if (page - 1 > 0) pages.add(page - 1);
  if (page + 1 < pageCount - 1) pages.add(page + 1);
  // Garde une largeur constante en début et fin de liste, pour que les numéros
  // ne se déplacent pas sous le curseur quand on avance page à page.
  if (page <= 2) [1, 2, 3].forEach((p) => p < pageCount - 1 && pages.add(p));
  if (page >= pageCount - 3)
    [pageCount - 4, pageCount - 3, pageCount - 2].forEach((p) => p > 0 && pages.add(p));

  const sorted = [...pages].sort((a, b) => a - b);
  const withGaps: number[] = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) withGaps.push(-1);
    withGaps.push(p);
  });
  return withGaps;
}

/** Boutons de page : 28 px, à l'échelle du pied de liste. */
const PAGE_BUTTON = "h-7 w-auto min-w-7 rounded-md px-1.5 text-xs shadow-none";

export function DataTablePagination({
  page,
  pageCount,
  pageSize,
  totalCount,
  onPageChange,
  onPageSizeChange,
  isLoading,
  itemLabel = "courrier",
}: DataTablePaginationProps) {
  const pages = getPageWindow(page, pageCount);
  const plural = totalCount > 1 ? "s" : "";
  const first = totalCount ? page * pageSize + 1 : 0;
  const last = Math.min((page + 1) * pageSize, totalCount);

  // Le retour en haut de liste au changement de page est l'affaire de la zone
  // qui défile (`ListScrollArea`, clé page + taille) : la pagination n'en fait
  // plus partie, elle reste en bas de l'écran.
  return (
    <ListFooter>
      <p aria-live="polite">
        {isLoading ? (
          "Chargement…"
        ) : pageCount > 1 ? (
          <>
            <span className="tabular-nums">
              {first.toLocaleString("fr-FR")}–{last.toLocaleString("fr-FR")}
            </span>{" "}
            sur <span className="tabular-nums">{totalCount.toLocaleString("fr-FR")}</span> {itemLabel}
            {plural}
          </>
        ) : (
          <>
            <span className="tabular-nums">{totalCount.toLocaleString("fr-FR")}</span> {itemLabel}
            {plural}
          </>
        )}
      </p>

      <div className="flex items-center gap-4">
        {onPageSizeChange && (
          <div className="flex items-center gap-2">
            <span className="whitespace-nowrap max-sm:sr-only">Par page</span>
            <Select value={String(pageSize)} onValueChange={(v) => onPageSizeChange(Number(v))}>
              <SelectTrigger className="h-7 w-[64px] rounded-md px-2 text-xs" aria-label="Lignes par page">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {pageCount > 1 && (
          <Pagination className="mx-0 w-auto">
            <PaginationContent className="gap-1">
              <PaginationItem>
                <PaginationLink
                  href="#"
                  aria-label="Page précédente"
                  aria-disabled={page === 0}
                  className={cn(PAGE_BUTTON, "border", page === 0 && "pointer-events-none opacity-50")}
                  onClick={(e) => {
                    e.preventDefault();
                    if (page > 0) onPageChange(page - 1);
                  }}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </PaginationLink>
              </PaginationItem>

              {pages.map((p, i) =>
                p === -1 ? (
                  <PaginationItem key={`gap-${i}`}>
                    <PaginationEllipsis className="h-7 w-5" />
                  </PaginationItem>
                ) : (
                  <PaginationItem key={p}>
                    <PaginationLink
                      href="#"
                      isActive={p === page}
                      aria-label={`Page ${p + 1}`}
                      className={cn(
                        PAGE_BUTTON,
                        "border-0 font-semibold tabular-nums",
                        p === page &&
                          "bg-primary font-bold text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground",
                      )}
                      onClick={(e) => {
                        e.preventDefault();
                        onPageChange(p);
                      }}
                    >
                      {p + 1}
                    </PaginationLink>
                  </PaginationItem>
                ),
              )}

              <PaginationItem>
                <PaginationLink
                  href="#"
                  aria-label="Page suivante"
                  aria-disabled={page >= pageCount - 1}
                  className={cn(PAGE_BUTTON, "border", page >= pageCount - 1 && "pointer-events-none opacity-50")}
                  onClick={(e) => {
                    e.preventDefault();
                    if (page < pageCount - 1) onPageChange(page + 1);
                  }}
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </PaginationLink>
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        )}
      </div>
    </ListFooter>
  );
}
