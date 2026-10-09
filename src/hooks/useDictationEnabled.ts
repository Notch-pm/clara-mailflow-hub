import { useQuery } from "@tanstack/react-query";
import { isDictationEnabled } from "@/services/dictationService";

/**
 * La dictée vocale est-elle ouverte pour cette collectivité ? Affichage
 * seulement — `transcribe-dictation` relit le drapeau avant chaque appel.
 */
export function useDictationEnabled(organizationId: string | null | undefined, enabled = true): boolean {
  const { data } = useQuery({
    queryKey: ["dictation-enabled", organizationId],
    queryFn: () => isDictationEnabled(organizationId!),
    enabled: !!organizationId && enabled,
    staleTime: 5 * 60_000,
  });
  return data === true;
}
