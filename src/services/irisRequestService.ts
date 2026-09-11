import { supabase } from "@/integrations/supabase/client";

// Dépôt d'une action de courrier dans Iris, propriétaire exclusif des demandes
// d'usagers de la gamme. Le client ne construit AUCUNE enveloppe : il désigne
// un ticket, l'edge function relit tout en base et décide. Une action sans
// démarche du référentiel reste dans Clara — l'edge la refuse poliment, ce
// n'est pas une panne. Depuis le 2026-09-11 l'écran n'en crée plus (toute
// demande part d'une démarche Iris ou partenaire) : seuls les tickets d'avant
// et les démarches Arpège passent encore par ce refus.

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
  /** Pièces du formulaire effectivement déposées avec la demande. */
  attachments_registered?: number;
  /**
   * Pièces réclamées par la démarche qui ne sont PAS parties (format qu'Iris
   * n'admet pas, fichier introuvable…) : la demande est déposée quand même,
   * mais incomplète — à dire à l'agent, pas à taire.
   */
  attachments_refused?: string | null;
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

export interface IrisRefreshResult {
  examinees?: number;
  mises_a_jour?: number;
  avertissements?: string[];
  skipped?: boolean;
  reason?: string;
}

/**
 * Relit l'état des demandes Iris d'un courrier. Appelé à l'ouverture de
 * l'onglet « Actions liées » : sans lui, l'écran montrerait l'état écrit au
 * dépôt jusqu'à la réconciliation nocturne (03:30), alors que la demande est
 * instruite dans Iris dans la minute.
 *
 * Silencieux par nature — l'agent n'a rien demandé, il a ouvert un onglet :
 * l'échec se journalise, il ne s'affiche pas.
 */
export async function refreshIrisStatuses(courierId: string): Promise<IrisRefreshResult> {
  const res = await supabase.functions.invoke("refresh-iris-status", {
    body: { courier_id: courierId },
  });
  if (res.error) throw new Error(res.error.message);
  return (res.data ?? {}) as IrisRefreshResult;
}
