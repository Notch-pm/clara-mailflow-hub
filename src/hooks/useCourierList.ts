import { useCallback, useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { SortingState } from "@tanstack/react-table";
import {
  fetchCourierListPage,
  isCourierSortKey,
  type CourierListFilters,
  type CourierListRow,
  type CourierSortDir,
  type CourierSortKey,
} from "@/services/courierListService";

const DEFAULT_PAGE_SIZE = 25;

export interface CourierSort {
  key: CourierSortKey;
  dir: CourierSortDir;
}

interface UseCourierListOptions {
  /** Préfixe de queryKey, propre à la page (invalidations ciblées). */
  queryKeyPrefix: string;
  defaultPageSize?: number;
  /**
   * Ordre initial. Obligatoire : chaque page doit se prononcer sur l'ordre
   * qu'elle affiche par défaut, plutôt que d'hériter silencieusement d'un tri
   * par date de réception qui n'a pas de sens partout (les Sortants n'en ont
   * pas, les Traités trient par date de traitement).
   */
  defaultSort: CourierSort;
  enabled?: boolean;
}

export interface UseCourierListResult {
  rows: CourierListRow[];
  totalCount: number;
  pageCount: number;
  page: number;
  setPage: (page: number) => void;
  pageSize: number;
  setPageSize: (size: number) => void;
  /** Tri courant, au format attendu par `<DataTable sorting={…}>`. */
  sorting: SortingState;
  onSortingChange: (sorting: SortingState) => void;
  /**
   * Filtres réellement envoyés au RPC, tri compris. C'est CEUX-LÀ qu'il faut
   * passer à `fetchAllCouriersForExport` : le CSV sort alors dans l'ordre
   * affiché à l'écran.
   */
  filters: CourierListFilters | null;
  isLoading: boolean;
  isFetching: boolean;
}

/**
 * Pagination et tri SERVEUR d'une liste de courriers.
 *
 * Détient l'état page/taille/tri et garde les invariants qui cassent une liste
 * filtrée : revenir en page 1 quand les filtres OU le tri changent, et se
 * recaler quand la page courante dépasse le nombre de pages (suppression d'un
 * courrier depuis la dernière page).
 *
 * Le tri est poussé jusqu'au RPC et porte donc sur l'intégralité du jeu filtré,
 * pas sur la page affichée — c'est toute la raison d'être de ce détour. Les
 * colonnes triables sont limitées à `COURIER_SORT_KEYS` ; voir le commentaire
 * qui y est attaché pour les colonnes exclues.
 */
export function useCourierList(
  filters: CourierListFilters | null,
  {
    queryKeyPrefix,
    defaultPageSize = DEFAULT_PAGE_SIZE,
    defaultSort,
    enabled = true,
  }: UseCourierListOptions,
): UseCourierListResult {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(defaultPageSize);
  const [sort, setSort] = useState<CourierSort>(defaultSort);

  // Le tri est fusionné APRÈS les filtres de la page : si l'une d'elles laisse
  // traîner un `sortBy`, c'est le choix de l'utilisateur qui l'emporte.
  const effectiveFilters = useMemo<CourierListFilters | null>(
    () => (filters ? { ...filters, sortBy: sort.key, sortDir: sort.dir } : null),
    [filters, sort],
  );

  // Sérialisation stable : les pages reconstruisent l'objet filtres à chaque
  // rendu, comparer les références relancerait la requête en boucle.
  const filtersKey = useMemo(() => JSON.stringify(effectiveFilters), [effectiveFilters]);

  // Filtrer — ou trier — depuis la page 7 laisserait sinon un tableau vide, ou
  // pire, la 7ᵉ page d'un ordre que l'utilisateur vient tout juste de changer.
  useEffect(() => {
    setPage(0);
  }, [filtersKey, pageSize]);

  const query = useQuery({
    queryKey: [queryKeyPrefix, filtersKey, page, pageSize],
    queryFn: () => fetchCourierListPage(effectiveFilters!, page, pageSize),
    enabled: enabled && !!effectiveFilters,
    // Sans cela le tableau se vide à chaque changement de page.
    placeholderData: keepPreviousData,
  });

  const totalCount = query.data?.totalCount ?? 0;
  const pageCount = query.data?.pageCount ?? 1;

  useEffect(() => {
    if (!query.isFetching && page > 0 && page >= pageCount) setPage(pageCount - 1);
  }, [page, pageCount, query.isFetching]);

  const sorting = useMemo<SortingState>(
    () => [{ id: sort.key, desc: sort.dir === "desc" }],
    [sort],
  );

  const onSortingChange = useCallback((next: SortingState) => {
    const first = next[0];
    // `next` peut être vide (tri retiré) : le serveur, lui, doit toujours
    // ordonner. On conserve alors le tri courant plutôt que de retomber dans un
    // ordre non spécifié, où les pages se recouvriraient.
    if (!first) return;
    if (!isCourierSortKey(first.id)) {
      // Une colonne triable dont l'`id` n'est pas une clé serveur : erreur de
      // câblage dans la page, pas une saisie utilisateur.
      console.warn(`useCourierList : colonne « ${first.id} » non triable côté serveur, tri ignoré.`);
      return;
    }
    setSort({ key: first.id, dir: first.desc ? "desc" : "asc" });
  }, []);

  return {
    rows: query.data?.rows ?? [],
    totalCount,
    pageCount,
    page,
    setPage,
    pageSize,
    setPageSize,
    sorting,
    onSortingChange,
    filters: effectiveFilters,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
  };
}
