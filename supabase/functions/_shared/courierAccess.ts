// Courriers confidentiels, côté edge functions.
//
// Les edge functions tournent en service_role et BYPASSENT la RLS : la règle
// « confidentiel » (migration 20261013160000_courriers_confidentiels.sql) ne
// les protège donc pas. Avant de rendre le contenu d'un courrier à un
// utilisateur (pièce, IA, envoi), on pose la question à la base AVEC SON
// JETON : `can_read_courier` y applique la même règle que les écrans.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

/** Ce qu'on écrit à la place de l'objet d'un courrier confidentiel (courriel, notification). */
export const CONFIDENTIAL_SUBJECT = "Courrier confidentiel";

/**
 * L'utilisateur porteur de `authHeader` (« Bearer … ») peut-il lire ce
 * courrier ? `false` sans jeton, sur erreur, ou si le courrier n'existe pas :
 * dans le doute, on ne rend rien.
 */
export async function canReadCourier(authHeader: string | null, courierId: string): Promise<boolean> {
  if (!authHeader) return false;
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anonKey) return false;
  const client = createClient(url, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: authHeader } },
  });
  const { data, error } = await client.rpc("can_read_courier", { p_courier_id: courierId });
  if (error) {
    console.error("can_read_courier :", error.message);
    return false;
  }
  return data === true;
}

interface AdminLike {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => { maybeSingle: () => Promise<{ data: unknown; error: unknown }> };
    };
  };
}

/** Le courrier est-il confidentiel ? (Lecture service role, pour masquer un courriel ou une notification.) */
export async function isCourierConfidential(admin: AdminLike, courierId: string): Promise<boolean> {
  const { data } = await admin.from("couriers").select("is_confidential").eq("id", courierId).maybeSingle();
  return (data as { is_confidential?: boolean } | null)?.is_confidential === true;
}
