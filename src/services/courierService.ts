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

/**
 * Ce qu'il faut pour calculer les échéances d'un courrier (délais de traitement).
 * Relu à part, et non pris dans le courrier chargé à l'ouverture : les deux
 * dates sont posées par trigger, au gré des transitions du courrier et de ses
 * réponses.
 */
export async function getCourierSlaFacts(organizationId: string, courierId: string) {
  const { data, error } = await supabase
    .from("couriers")
    .select("received_at, created_at, acknowledged_at, resolved_at")
    .eq("organization_id", organizationId)
    .eq("id", courierId)
    .single();
  if (error) throw error;
  return data;
}

/**
 * L'identifiant est posé ici et la ligne n'est pas relue : un courrier créé
 * pour une organisation hors du périmètre de l'agent (RLS) ne lui est plus
 * lisible, et un `insert().select()` échouerait alors qu'il est bien créé.
 */
export async function createCourier(data: CourierInsert) {
  const id = data.id ?? crypto.randomUUID();
  const { error } = await supabase.from("couriers").insert({ ...data, id });
  return { data: error ? null : { id }, error };
}

/**
 * Poser ou lever la confidentialité. Par RPC et non par `updateCourier` : pour
 * le service courrier non habilité, la ligne devenue confidentielle lui est
 * cachée et l'écriture directe échouerait. Les droits (poser : habilité ou
 * service courrier ; lever : habilité) sont vérifiés par la base.
 */
export async function setCourierConfidential(courierId: string, confidential: boolean): Promise<void> {
  const { error } = await supabase.rpc("set_courier_confidential", {
    p_courier_id: courierId,
    p_confidential: confidential,
  });
  if (error) throw error;
}

export type CourierAccess = "ok" | "confidential" | "out_of_scope" | "missing";

/**
 * Pourquoi un courrier ne s'ouvre pas : confidentiel (il existe, je n'y ai pas
 * accès) ou absent. Appelé quand la lecture directe ne rend rien.
 */
export async function getCourierAccess(courierId: string): Promise<CourierAccess> {
  const { data, error } = await supabase.rpc("courier_access", { p_courier_id: courierId });
  if (error) throw error;
  return (data as CourierAccess) ?? "missing";
}

/** Un autre agent a modifié le courrier depuis son chargement : l'écriture est refusée. */
export class ConcurrentUpdateError extends Error {
  constructor(public editorName: string | null) {
    super(
      `L'enregistrement a échoué car les informations ont été mises à jour en parallèle par ${editorName ?? "un autre agent"}. ` +
        "Rechargez le courrier pour voir ses modifications.",
    );
    this.name = "ConcurrentUpdateError";
  }
}

/**
 * Écriture conditionnée à la version chargée (`updated_at`) : verrouillage
 * optimiste. Si la ligne a bougé entre-temps :
 *  - par un AUTRE agent → `ConcurrentUpdateError` (qui, d'après `updated_by`) ;
 *  - par soi-même (autre panneau) ou par le serveur (analyse, relève) → on
 *    reprend la version courante et on réessaie une fois.
 * Rend la nouvelle version, à garder pour l'écriture suivante.
 */
export async function updateCourierVersioned(
  organizationId: string,
  courierId: string,
  data: CourierUpdate,
  expectedUpdatedAt: string,
  retry = true,
): Promise<string> {
  const { data: rows, error } = await supabase
    .from("couriers")
    .update(data)
    .eq("organization_id", organizationId)
    .eq("id", courierId)
    .eq("updated_at", expectedUpdatedAt)
    .select("updated_at");
  if (error) throw error;
  if (rows && rows.length > 0) return rows[0].updated_at;

  const { data: last, error: lastErr } = await supabase.rpc("courier_last_editor", { p_courier_id: courierId });
  if (lastErr) throw lastErr;
  const row = (last ?? [])[0];
  if (!row) throw new Error("Modification refusée : courrier introuvable ou droits insuffisants.");
  const { data: session } = await supabase.auth.getSession();
  const me = session.session?.user.id;
  if (retry && (!row.updated_by || row.updated_by === me)) {
    return updateCourierVersioned(organizationId, courierId, data, row.updated_at, false);
  }
  throw new ConcurrentUpdateError(row.editor_name);
}

/**
 * Sans relecture : un transfert vers une autre organisation sort le courrier
 * du périmètre de l'agent (RLS), et un `update().select()` échouerait alors.
 */
export async function updateCourier(organizationId: string, courierId: string, data: CourierUpdate) {
  const { error, count } = await supabase
    .from("couriers")
    .update(data, { count: "exact" })
    .eq("organization_id", organizationId)
    .eq("id", courierId);
  if (error) return { error };
  // Rien de modifié = droits refusés ou courrier disparu (ce que `.single()` signalait).
  if (count === 0) return { error: new Error("Modification refusée : courrier introuvable ou droits insuffisants.") };
  return { error: null };
}

/**
 * « Supprimer » place le courrier — et ses réponses — dans la corbeille, d'où
 * il se restaure pendant 30 jours (voir `trashService.ts`). La suppression
 * définitive ne se fait que depuis l'écran « Corbeille et spam » ou par la purge.
 */
export async function deleteCourier(organizationId: string, courierId: string) {
  return supabase.rpc("trash_courier", {
    p_organization_id: organizationId,
    p_courier_id: courierId,
  });
}
