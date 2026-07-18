import { useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
} from "@/components/ui/pagination";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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

/**
 * Ramène en haut le conteneur de défilement qui contient la liste.
 *
 * Sans cela, changer de page conserve la position de défilement : on arrive en
 * bas de la nouvelle page, titre et filtres hors écran — et si la page d'arrivée
 * est plus courte (dernière page), le navigateur laisse la position au maximum.
 * On remonte l'arbre plutôt que de viser `main` en dur, pour que le composant
 * reste utilisable dans un autre conteneur.
 */
function scrollListToTop(node: HTMLElement | null) {
  for (let el = node?.parentElement ?? null; el; el = el.parentElement) {
    const overflowY = getComputedStyle(el).overflowY;
    if ((overflowY === "auto" || overflowY === "scroll") && el.scrollHeight > el.clientHeight) {
      el.scrollTo({ top: 0 });
      return;
    }
  }
  globalThis.scrollTo({ top: 0 });
}

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
  const rootRef = useRef<HTMLDivElement>(null);
  const pages = getPageWindow(page, pageCount);
  const plural = totalCount > 1 ? "s" : "";

  function goToPage(next: number) {
    onPageChange(next);
    scrollListToTop(rootRef.current);
  }

  return (
    <div
      ref={rootRef}
      className="flex flex-col gap-3 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {isLoading ? (
          "Chargement…"
        ) : (
          <>
            {totalCount.toLocaleString("fr-FR")} {itemLabel}
            {plural}
            {pageCount > 1 && ` · page ${page + 1} sur ${pageCount}`}
          </>
        )}
      </p>

      <div className="flex items-center gap-4">
        {onPageSizeChange && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground whitespace-nowrap">Par page</span>
            <Select value={String(pageSize)} onValueChange={(v) => { onPageSizeChange(Number(v)); scrollListToTop(rootRef.current); }}>
              <SelectTrigger className="h-8 w-[72px]">
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
            <PaginationContent>
              <PaginationItem>
                <PaginationLink
                  href="#"
                  size="default"
                  aria-label="Page précédente"
                  aria-disabled={page === 0}
                  className={cn("gap-1 pl-2.5", page === 0 && "pointer-events-none opacity-50")}
                  onClick={(e) => {
                    e.preventDefault();
                    if (page > 0) goToPage(page - 1);
                  }}
                >
                  <ChevronLeft className="h-4 w-4" />
                  <span className="hidden sm:inline">Précédent</span>
                </PaginationLink>
              </PaginationItem>

              {pages.map((p, i) =>
                p === -1 ? (
                  <PaginationItem key={`gap-${i}`}>
                    <PaginationEllipsis />
                  </PaginationItem>
                ) : (
                  <PaginationItem key={p}>
                    <PaginationLink
                      href="#"
                      isActive={p === page}
                      aria-label={`Page ${p + 1}`}
                      onClick={(e) => {
                        e.preventDefault();
                        goToPage(p);
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
                  size="default"
                  aria-label="Page suivante"
                  aria-disabled={page >= pageCount - 1}
                  className={cn("gap-1 pr-2.5", page >= pageCount - 1 && "pointer-events-none opacity-50")}
                  onClick={(e) => {
                    e.preventDefault();
                    if (page < pageCount - 1) goToPage(page + 1);
                  }}
                >
                  <span className="hidden sm:inline">Suivant</span>
                  <ChevronRight className="h-4 w-4" />
                </PaginationLink>
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        )}
      </div>
    </div>
  );
}
