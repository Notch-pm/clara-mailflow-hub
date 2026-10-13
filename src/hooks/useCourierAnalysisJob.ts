import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getLatestAnalysisJob, isAnalysisJobInProgress } from "@/services/courierAnalysisJobService";
import { COURIER_LIST_QUERY_PREFIXES } from "@/services/courierListService";

/** Relecture de la file tant que l'analyse du courrier est en attente ou en cours. */
const POLL_MS = 3_000;

export const courierAnalysisJobQueryKey = (courierId: string | null | undefined) =>
  ["courier-analysis-job", courierId] as const;

/**
 * Suit l'analyse du courrier enfilée côté serveur (`process-analysis-queue`).
 *
 * Personne n'attend la réponse de la file : sans ce suivi, la fiche ouverte
 * pendant l'analyse gardait « Aucune analyse » jusqu'à un rechargement. À la fin
 * du job (réussi ou en échec), on relit tout ce que l'analyse a pu écrire :
 * analyse, extraits OCR, courrier (tags, objet) et listes.
 *
 * À monter UNE fois par courrier affiché (`useCourierWorkspace`) ; un composant
 * qui n'a besoin que de l'état lit `courierAnalysisJobQueryKey` avec `useQuery`.
 */
export function useCourierAnalysisJob(organizationId: string | null | undefined, courierId: string | null | undefined) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: courierAnalysisJobQueryKey(courierId),
    queryFn: () => getLatestAnalysisJob(organizationId!, courierId!),
    enabled: !!organizationId && !!courierId,
    refetchInterval: (q) => (isAnalysisJobInProgress(q.state.data) ? POLL_MS : false),
  });

  const inProgress = isAnalysisJobInProgress(query.data);
  // Courrier observé au rendu précédent : un changement de courrier n'est pas une fin d'analyse.
  const previous = useRef<{ courierId: string | null | undefined; inProgress: boolean }>({ courierId, inProgress: false });

  useEffect(() => {
    const ended = previous.current.courierId === courierId && previous.current.inProgress && !inProgress;
    previous.current = { courierId, inProgress };
    if (ended && courierId) {
      qc.invalidateQueries({ queryKey: ["courier-analysis", courierId] });
      qc.invalidateQueries({ queryKey: ["courier-extracts", courierId] });
      qc.invalidateQueries({ queryKey: ["courier-events", courierId] });
      // Le courrier est rangé sous ["courier", id, org] ou ["courier", org, id] selon l'écran.
      qc.invalidateQueries({
        predicate: (q) => q.queryKey[0] === "courier" && q.queryKey.includes(courierId),
      });
      COURIER_LIST_QUERY_PREFIXES.forEach((prefix) => qc.invalidateQueries({ queryKey: [prefix] }));
    }
  }, [inProgress, courierId, qc]);

  return { job: query.data ?? null, inProgress };
}
