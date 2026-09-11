// Recherche globale du tableau de bord — les DEUX sources, et le rythme de la
// frappe.
//
//  · les COURRIERS sont des données Clara : RPC `search_couriers` via
//    `fetchCourierListPage`, borné au tenant par la RLS ET au périmètre de
//    l'agent par `visibleSocleOrganizationIds` (la RLS de `couriers` ne filtre
//    qu'au niveau du tenant, pas du service) ;
//  · les USAGERS vivent dans le Socle : `socle-contacts`, seul point d'appel
//    autorisé vers le référentiel.
//
// Invariant : aucun usager n'est mis en cache par Clara (`gcTime: 0`), comme
// partout ailleurs. Une panne du référentiel ne fait pas échouer la recherche :
// elle en retire le groupe « Usagers ».

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchCourierListPage, type CourierListRow } from "@/services/courierListService";
import { listContacts, type SocleContact } from "@/services/socleContactService";
import type { Database } from "@/integrations/supabase/types";
import {
  buildGroups,
  isSearchable,
  normalizeQuery,
  RESULTS_PER_KIND,
  SEARCH_DEBOUNCE_MS,
  type SearchGroup,
} from "./global-search";

type WorkflowCategory = Database["public"]["Enums"]["workflow_category"];

const THIRTY_SECONDS = 30_000;

/**
 * Valeur retardée d'un délai : le cache de TanStack Query dédoublonne les
 * préfixes déjà tapés, ce délai-ci évite d'ÉMETTRE la requête intermédiaire —
 * un aller-retour par caractère sinon.
 */
function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export interface GlobalSearchResult {
  groups: SearchGroup[];
  /** Une requête est en vol pour une saisie sans réponse affichée. */
  isLoading: boolean;
  /** La frappe est en avance sur les résultats affichés. */
  isStale: boolean;
  /** Le référentiel d'usagers n'a pas répondu — les courriers, eux, sont là. */
  usagersUnavailable: boolean;
  /** Les courriers n'ont pas pu être lus (panne, session expirée). */
  couriersFailed: boolean;
  /** La recherche a rendu son verdict : le vide affiché est un vrai « rien ». */
  settled: boolean;
}

export function useGlobalSearch(
  organizationId: string,
  /** Périmètre RBAC — `useUserServiceFilter()`. `null` = aucune restriction. */
  visibleSocleOrganizationIds: string[] | null,
  raw: string,
): GlobalSearchResult {
  const query = normalizeQuery(raw);
  const debounced = useDebounced(query, SEARCH_DEBOUNCE_MS);
  const active = Boolean(organizationId) && isSearchable(debounced);

  const couriers = useQuery({
    queryKey: [
      "global-search-couriers",
      organizationId,
      visibleSocleOrganizationIds,
      debounced,
    ],
    enabled: active,
    staleTime: THIRTY_SECONDS,
    // Pendant la frappe, un échec se remplace tout seul au caractère suivant.
    retry: false,
    queryFn: async (): Promise<CourierListRow[]> => {
      const { rows } = await fetchCourierListPage(
        {
          organizationId,
          // Toutes directions, tous états : la barre cherche dans l'ensemble du
          // courrier, pas dans une liste.
          visibleSocleOrganizationIds,
          keywords: debounced,
          // Recherche par préfixe, comme les listes : « raccord » doit trouver
          // « raccordement » dès la frappe.
          prefixMatch: true,
          sortBy: "received_at",
        },
        0,
        RESULTS_PER_KIND,
      );
      return rows;
    },
  });

  const usagers = useQuery({
    queryKey: ["global-search-usagers", organizationId, debounced],
    enabled: active,
    // Aucune rétention : Clara ne met aucune identité en cache (invariant).
    gcTime: 0,
    staleTime: 0,
    retry: false,
    queryFn: async (): Promise<SocleContact[]> =>
      listContacts(organizationId, {
        search: debounced,
        status: "active",
        limit: RESULTS_PER_KIND,
      }),
  });

  // Les états ne sont chargés qu'une fois une recherche lancée : la barre n'a
  // pas à interroger le tenant tant que personne n'a rien cherché.
  const states = useQuery({
    queryKey: ["global-search-workflow-states", organizationId],
    enabled: active,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("workflow_states")
        .select("id, name, category")
        .eq("organization_id", organizationId);
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; name: string; category: WorkflowCategory }>;
    },
  });

  const stateById = useMemo(() => {
    const map = new Map<string, { name: string; category: WorkflowCategory }>();
    for (const s of states.data ?? []) map.set(s.id, { name: s.name, category: s.category });
    return map;
  }, [states.data]);
  const stateOf = useCallback((id: string) => stateById.get(id), [stateById]);

  // Le `?? []` vit DANS le useMemo : dehors, il forgerait un tableau neuf à
  // chaque rendu tant qu'une source n'a pas répondu, et le regroupement serait
  // recalculé pour rien.
  const courierHits = couriers.data;
  const contactHits = usagers.data;
  const groups = useMemo(
    () => buildGroups(courierHits ?? [], contactHits ?? [], stateOf),
    [courierHits, contactHits, stateOf],
  );

  // `states` compte dans le chargement : sans lui, les lignes s'affichent une
  // première fois SANS libellé d'état, qui apparaît ensuite d'un coup.
  const isLoading = couriers.isFetching || usagers.isFetching || states.isFetching;
  return {
    groups,
    isLoading,
    isStale: debounced !== query,
    // Gardés sur la saisie AFFICHÉE : pendant la temporisation, l'échec du
    // préfixe précédent ne parle pas de ce que l'agent est en train de taper.
    usagersUnavailable: usagers.isError && debounced === query,
    couriersFailed: couriers.isError && debounced === query,
    settled: active && !isLoading && debounced === query,
  };
}
