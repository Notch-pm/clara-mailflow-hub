import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** Message commun aux écrans verrouillés. */
export const MANAGED_BY_SOCLE_MESSAGE =
  "Les accès à Clara, le rôle et les organisations de rattachement se gèrent dans le Socle " +
  "(Paramètres › Utilisateurs). Les droits propres à Clara — signataire, viseur, " +
  "gestionnaire courrier, confidentiel — se règlent ici.";

/**
 * Le tenant est-il rattaché au Socle ? Ses agents sont alors gérés par lui
 * (fonction `sync-socle-users`) : invitation, rôle de base, activation et
 * affectations aux organisations ne s'éditent plus dans Clara.
 */
export function useAgentsManagedBySocle(organizationId: string | null | undefined): boolean {
  const { data } = useQuery({
    queryKey: ["agents-managed-by-socle", organizationId],
    enabled: Boolean(organizationId),
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organizations")
        .select("socle_org_id")
        .eq("id", organizationId!)
        .maybeSingle();
      if (error) throw error;
      return Boolean(data?.socle_org_id);
    },
  });
  return data === true;
}
