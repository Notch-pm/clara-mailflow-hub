// Abonnements Web Push — accès Supabase typé (règle d'or n°3 : la logique
// métier n'est pas dans les composants, l'accès base n'est pas dans les hooks).
//
// Ce fichier porte AUSSI `forgetDevicePush` (lecture de l'abonnement du
// navigateur + retrait), et pas le hook : `AuthContext.signOut` en a besoin, et
// le hook importe `useAuth` — les faire s'importer l'un l'autre créerait un
// cycle. Le retrait est le seul geste push dont la déconnexion a besoin.
//
// Écritures : une seule porte, la RPC `register_push_subscription`. La table n'a
// PAS de policy INSERT cliente, parce qu'un `insert` borné à
// `user_id = auth.uid()` ne pourrait pas reprendre l'endpoint d'un collègue sur
// un poste partagé d'accueil — et l'appareil recevrait alors les notifications
// du titulaire précédent.

import { supabase } from "@/integrations/supabase/client";
import type { SubscriptionRow } from "@/lib/push";

/** Enregistre (ou reprend) l'abonnement de cet appareil pour le compte connecté. */
export async function registerPushSubscription(row: SubscriptionRow): Promise<void> {
  const { error } = await supabase.rpc("register_push_subscription", {
    p_endpoint: row.endpoint,
    p_p256dh: row.p256dh,
    p_auth: row.auth,
    p_user_agent: row.user_agent,
  });
  if (error) throw error;
}

/**
 * L'abonnement du navigateur correspond-il à une ligne à MOI ?
 * Le RLS ne rend que mes lignes : une ligne trouvée est la mienne.
 */
export async function isMyPushSubscription(endpoint: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("push_subscriptions")
    .select("id")
    .eq("endpoint", endpoint)
    .limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}

/** Retrait de l'abonnement de cet appareil (déconnexion, interrupteur coupé). */
export async function deletePushSubscription(endpoint: string): Promise<void> {
  await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
}

/** Marque l'appareil vivant — décoratif, sert à repérer les abonnements dormants. */
export async function touchPushSubscription(endpoint: string): Promise<void> {
  await supabase
    .from("push_subscriptions")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("endpoint", endpoint);
}

/** L'abonnement que ce navigateur détient pour cette origine, s'il y en a un. */
export async function currentPushSubscription(): Promise<PushSubscription | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  const registration = await navigator.serviceWorker.getRegistration("/");
  if (!registration) return null;
  return registration.pushManager.getSubscription();
}

/**
 * Retire l'abonnement de CET appareil : la ligne d'abord (un push en vol tombe
 * alors sur un appareil qui n'écoute plus, pas l'inverse), puis le navigateur.
 * Best effort : appelé aussi à la déconnexion, où rien ne doit bloquer.
 */
export async function forgetDevicePush(): Promise<void> {
  try {
    const sub = await currentPushSubscription();
    if (!sub) return;
    await deletePushSubscription(sub.endpoint);
    await sub.unsubscribe();
  } catch {
    /* déconnexion : on ne retient jamais l'agent pour ça */
  }
}
