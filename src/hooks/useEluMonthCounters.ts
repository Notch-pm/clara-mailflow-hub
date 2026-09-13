import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";
import { useUserServiceFilter } from "@/hooks/useUserServiceFilter";
import { fetchCourierListPage, type CourierListFilters } from "@/services/courierListService";

const FIVE_MINUTES = 5 * 60 * 1000;

/** Bornes du mois en cours, en date civile locale, INCLUSIVES aux deux bouts. */
function currentMonthBounds(now = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  // Le RPC compare `received_at::date <= p_date_to` : c'est le dernier jour du
  // mois qu'il faut passer, surtout pas le 1er du mois suivant.
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return { from: iso(first), to: iso(last), key: `${first.getFullYear()}-${pad(first.getMonth() + 1)}` };
}

export interface EluMonthCounters {
  recus: number;
  enAttente: number;
  enInstruction: number;
  enTraitement: number;
  traites: number;
  monthLabel: string;
}

/**
 * Les trois chiffres de l'accueil.
 *
 * On ne reprend pas la méthode du tableau de bord complet, qui charge TOUS les
 * courriers entrants de l'organisation sans limite pour les compter en
 * JavaScript : sur un téléphone, c'est rédhibitoire. `search_couriers` sait
 * compter (`total_count`, calculé avant le découpage), donc quatre appels qui
 * ne rapatrient qu'une ligne chacun suffisent.
 *
 * Réserve assumée : les bornes de date portent sur `received_at`. « Traités ce
 * mois » compte donc les courriers REÇUS ce mois et aujourd'hui traités. La
 * vraie date de traitement vit dans `courier_events`, qui ne porte pas
 * `socle_organization_id` et ne saurait donc pas respecter le périmètre de
 * l'élu — le tableau de bord complet fait déjà la même approximation avec
 * `updated_at`.
 */
export function useEluMonthCounters() {
  const { organizationId } = useOrganization();
  const visibleSocleOrganizationIds = useUserServiceFilter();
  const { from, to, key } = currentMonthBounds();

  const { data: states } = useQuery({
    queryKey: ["elu-workflow-states", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("workflow_states")
        .select("id, category, is_initial")
        .eq("organization_id", organizationId!);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!organizationId,
    staleTime: FIVE_MINUTES,
  });

  const initialStateIds = (states ?? []).filter((s) => s.is_initial).map((s) => s.id);
  const processingStateIds = (states ?? []).filter((s) => s.category === "processing").map((s) => s.id);
  const processedStateIds = (states ?? []).filter((s) => s.category === "processed").map((s) => s.id);

  const { data, isLoading } = useQuery<EluMonthCounters>({
    queryKey: [
      "elu-month-counters",
      organizationId,
      visibleSocleOrganizationIds,
      key,
      initialStateIds,
      processingStateIds,
      processedStateIds,
    ],
    queryFn: async () => {
      const base: CourierListFilters = {
        organizationId: organizationId!,
        direction: "inbound",
        visibleSocleOrganizationIds,
      };
      // Page de UNE ligne : seul `total_count` nous intéresse.
      const count = async (filters: CourierListFilters) =>
        (await fetchCourierListPage(filters, 0, 1)).totalCount;

      const [recus, enAttente, enInstruction, traites] = await Promise.all([
        count({ ...base, dateFrom: from, dateTo: to }),
        // Les courriers sans état sont bien en attente : la boîte aux lettres
        // les compte de la même façon.
        count({ ...base, workflowStateIds: initialStateIds, includeNullState: true }),
        count({ ...base, workflowStateIds: processingStateIds }),
        count({ ...base, workflowStateIds: processedStateIds, dateFrom: from, dateTo: to }),
      ]);

      return {
        recus,
        enAttente,
        enInstruction,
        enTraitement: enAttente + enInstruction,
        traites,
        monthLabel: new Date().toLocaleDateString("fr-FR", { month: "long", year: "numeric" }),
      };
    },
    enabled: !!organizationId && !!states,
    staleTime: 60_000,
  });

  return { counters: data ?? null, isLoading };
}
