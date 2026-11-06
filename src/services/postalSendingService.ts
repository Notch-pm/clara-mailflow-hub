import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { edgeError } from "@/lib/edge-error";

// Envois papiers réels : l'interrupteur de la collectivité et le journal des
// envois par le prestataire (Merci Facteur, compte unique Notch).
// L'activation est réservée aux administrateurs par la RLS d'`organizations`
// (`org_admin_update` → `is_admin_of`) ; `postal_sendings` n'est écrite que par
// les edge functions (service role) : le navigateur ne fait que la lire.

export type PostalSending = Database["public"]["Tables"]["postal_sendings"]["Row"];

export interface PostalSendingSettings {
  enabled: boolean;
  dailyCap: number;
}

export async function getPostalSendingSettings(organizationId: string): Promise<PostalSendingSettings> {
  const { data, error } = await supabase
    .from("organizations")
    .select("postal_sending_enabled, postal_daily_cap")
    .eq("id", organizationId)
    .single();
  if (error) throw error;
  return { enabled: data.postal_sending_enabled === true, dailyCap: data.postal_daily_cap };
}

export async function updatePostalSendingSettings(
  organizationId: string,
  patch: Partial<PostalSendingSettings>,
): Promise<void> {
  const update: Database["public"]["Tables"]["organizations"]["Update"] = {};
  if (patch.enabled !== undefined) update.postal_sending_enabled = patch.enabled;
  if (patch.dailyCap !== undefined) update.postal_daily_cap = patch.dailyCap;
  // Sans `select`, une mise à jour refusée par la RLS « réussit » sur 0 ligne.
  const { data, error } = await supabase
    .from("organizations")
    .update(update)
    .eq("id", organizationId)
    .select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("Seul un administrateur de la collectivité peut modifier ce réglage.");
}

export type PostalSendingRow = PostalSending & { courier: { chrono: string | null; subject: string | null } | null };

/** Les derniers envois par le prestataire, du plus récent au plus ancien. */
export async function listPostalSendings(organizationId: string, limit = 50): Promise<PostalSendingRow[]> {
  const { data, error } = await supabase
    .from("postal_sendings")
    .select("*, courier:couriers(chrono, subject)")
    .eq("organization_id", organizationId)
    .order("requested_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as unknown as PostalSendingRow[];
}

export interface SendPostalLetterResult {
  posted_at: string;
  envoi_id: string | null;
  price_ttc: number | null;
  declared: boolean;
}

/**
 * Fait imprimer et poster la lettre par le prestataire (edge function
 * `send-postal-letter`). `documentId` : le PDF déjà déposé dans les documents
 * du courrier. Le serveur réserve l'envoi, refuse un second envoi, et déclare
 * lui-même le courrier « posté » une fois la lettre acceptée.
 */
export async function sendPostalLetter(args: {
  organizationId: string;
  courierId: string;
  mode: "simple" | "suivi" | "recommande";
  documentId: string;
}): Promise<SendPostalLetterResult> {
  const { data, error } = await supabase.functions.invoke("send-postal-letter", {
    body: {
      organization_id: args.organizationId,
      courier_id: args.courierId,
      mode: args.mode,
      document_id: args.documentId,
    },
  });
  if (error) throw await edgeError(error, "Envoi par le prestataire impossible");
  const result = data as (SendPostalLetterResult & { error?: string }) | null;
  if (!result || result.error) throw new Error(result?.error ?? "Envoi par le prestataire impossible");
  return result;
}
