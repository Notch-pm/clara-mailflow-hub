import { supabase } from "@/integrations/supabase/client";

// Dépôt d'une action de courrier dans Iris, propriétaire exclusif des demandes
// d'usagers de la gamme. Le client ne construit AUCUNE enveloppe : il désigne
// un ticket, l'edge function relit tout en base et décide. Une action sans
// démarche du référentiel (« demande libre ») reste dans Clara — l'edge la
// refuse poliment, ce n'est pas une panne.

export interface IrisPushResult {
  created?: boolean;
  request_id?: string | null;
  reference?: string | null;
  status?: string | null;
  url?: string | null;
  /**
   * L'organisation ne dépose pas ses demandes dans Iris (aucune interface
   * configurée) : rien n'a été tenté, et il n'y a rien à réparer.
   */
  skipped?: boolean;
  reason?: string;
}

/**
 * Dépose (ou re-dépose) la demande portée par une action. Le renvoi est sûr :
 * la clé d'idempotence du ticket est rejouée telle quelle, un contenu
 * identique renvoie la demande existante au lieu d'en créer une seconde.
 */
export async function pushIrisRequest(ticketId: string): Promise<IrisPushResult> {
  const res = await supabase.functions.invoke("push-iris-request", {
    body: { ticket_id: ticketId },
  });

  if (res.error) {
    // L'edge function répond `{ error }` avec un message en français destiné à
    // l'agent : on le préfère au « Edge Function returned a non-2xx status ».
    const ctx = (res.error as { context?: { json?: () => Promise<{ error?: string } | null> } }).context;
    let message: string | null = null;
    try {
      message = (await ctx?.json?.())?.error ?? null;
    } catch {
      /* corps illisible : on garde le message brut */
    }
    throw new Error(message || res.error.message);
  }

  return res.data as IrisPushResult;
}
