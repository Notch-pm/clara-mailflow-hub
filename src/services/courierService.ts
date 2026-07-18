import { supabase } from "@/integrations/supabase/client";
import type { CourierInsert, CourierUpdate } from "@/types/courier";

/**
 * Convertit une saisie utilisateur en `to_tsquery` à préfixes : « raccord eau »
 * devient « raccord:* & eau:* ».
 *
 * SPÉCIFICATION DE RÉFÉRENCE, plus appelée en production : les listes passent
 * désormais par le RPC `search_couriers`, dont la fonction SQL
 * `clara_search_tsquery(text, boolean)` doit reproduire exactement cette
 * tokenisation. Le test `src/test/services/toPrefixTsQuery.test.ts` fixe le
 * contrat que les deux implémentations partagent — le conserver évite que le
 * SQL dérive sans qu'on s'en aperçoive.
 *
 * Le `:*` est indispensable : sans lui la recherche plein texte n'accepterait
 * que des mots entiers, alors que l'ancien `ilike '%…%'` trouvait les préfixes.
 * Les caractères de syntaxe tsquery sont neutralisés, faute de quoi une saisie
 * comme « a & b » ferait échouer `to_tsquery` côté serveur.
 *
 * @returns null si la saisie ne contient aucun terme exploitable (le filtre est
 *   alors simplement omis, comme pour une recherche vide).
 */
export function toPrefixTsQuery(search: string): string | null {
  const tokens = search
    .replace(/[&|!():*'"\\<>]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return null;
  return tokens.map((token) => `${token}:*`).join(" & ");
}

export async function getCourierById(organizationId: string, courierId: string) {
  return supabase
    .from("couriers")
    .select("*, socle_organization:socle_organizations(id, name), courier_participants(*), courier_documents(*), courier_events(*), courier_links(*)")
    .eq("organization_id", organizationId)
    .eq("id", courierId)
    .single();
}

export async function createCourier(data: CourierInsert) {
  return supabase
    .from("couriers")
    .insert(data)
    .select()
    .single();
}

export async function updateCourier(organizationId: string, courierId: string, data: CourierUpdate) {
  return supabase
    .from("couriers")
    .update(data)
    .eq("organization_id", organizationId)
    .eq("id", courierId)
    .select()
    .single();
}

export async function deleteCourier(organizationId: string, courierId: string) {
  return supabase
    .from("couriers")
    .delete()
    .eq("organization_id", organizationId)
    .eq("id", courierId);
}
