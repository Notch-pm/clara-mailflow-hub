import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface OrgCoordinates {
  name: string;
  address_street: string | null;
  address_complement: string | null;
  address_postal_code: string | null;
  address_city: string | null;
  /** Adresse du référentiel, en texte libre — repli des colonnes ci-dessus. */
  address?: string | null;
  phone: string | null;
  website: string | null;
  contact_email: string | null;
  socle_org_id: string | null;
}

/**
 * Coordonnées de la collectivité pour les en-têtes de lettre.
 *
 * Les coordonnées propres de Clara sont souvent vides : depuis la bascule vers
 * le référentiel, l'adresse d'une collectivité y est saisie une fois pour
 * toute la gamme (`socle_organizations.address`, en texte libre). On relit
 * donc la ligne du référentiel correspondant au tenant et on s'en sert EN
 * REPLI — les colonnes de Clara, si elles sont remplies, restent prioritaires.
 * Sans ce repli, « Organisation (avec adresse) » n'imprimait que le nom pour
 * toute collectivité n'ayant jamais ressaisi son adresse dans Clara.
 */
export function useOrgCoordinates(organizationId: string) {
  return useQuery({
    queryKey: ["org-coordinates", organizationId],
    queryFn: async (): Promise<OrgCoordinates> => {
      const { data, error } = await supabase
        .from("organizations")
        .select("name, address_street, address_complement, address_postal_code, address_city, phone, website, contact_email, socle_org_id")
        .eq("id", organizationId)
        .single();
      if (error) throw error;
      const org = data as OrgCoordinates;
      if (!org.socle_org_id) return org;

      const { data: ref } = await supabase
        .from("socle_organizations")
        .select("address, phone, email")
        .eq("organization_id", organizationId)
        .eq("socle_id", org.socle_org_id)
        .maybeSingle();
      const referentiel = ref as { address: string | null; phone: string | null; email: string | null } | null;
      return {
        ...org,
        address: referentiel?.address ?? null,
        phone: org.phone ?? referentiel?.phone ?? null,
        contact_email: org.contact_email ?? referentiel?.email ?? null,
      };
    },
    enabled: !!organizationId,
  });
}
