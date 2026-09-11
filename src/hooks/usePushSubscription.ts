// Abonnement push de CET appareil — lecture du navigateur, enregistrement,
// retrait. Les règles (états, mapping, libellés) vivent dans le module pur
// `src/lib/push.ts` ; l'accès base dans `src/services/pushSubscriptionService.ts` ;
// ici, on lit le navigateur et on applique.
//
// Le service worker (`/sw.js`, push seul) n'est enregistré QU'À l'activation :
// sans abonnement il ne recevrait rien, et un service worker posé d'office est
// un cycle de vie de plus à déboguer pour zéro bénéfice. Une fois posé, c'est
// le navigateur qui le réveille au push, application fermée.
//
// Un abonnement du navigateur SANS ligne à moi en base (autre titulaire sur un
// poste partagé, ligne retirée ailleurs) est retiré du navigateur : cet
// appareil ne doit pas recevoir les notifications de quelqu'un d'autre.

import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import {
  isApplePlatform,
  resolvePushState,
  subscriptionToRow,
  urlBase64ToUint8Array,
  type PushState,
  type SubscriptionJson,
} from "@/lib/push";
import {
  currentPushSubscription,
  forgetDevicePush,
  isMyPushSubscription,
  registerPushSubscription,
  touchPushSubscription,
} from "@/services/pushSubscriptionService";

const SW_URL = "/sw.js";

/** Clé PUBLIQUE VAPID : elle voyage dans chaque abonnement, ce n'est pas un
 *  secret — sa place est bien dans le bundle (cf. `.env.example`). */
const PUBLIC_KEY: string = (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined) ?? "";

export const pushKeys = {
  device: (userId: string) => ["push-subscription", userId] as const,
};

function browserSupport() {
  return {
    hasServiceWorker: typeof navigator !== "undefined" && "serviceWorker" in navigator,
    hasPushManager: typeof window !== "undefined" && "PushManager" in window,
    hasNotification: typeof window !== "undefined" && "Notification" in window,
  };
}

async function registerRow(json: SubscriptionJson): Promise<void> {
  const row = subscriptionToRow(json, navigator.userAgent);
  if (!row) throw new Error("L'abonnement rendu par le navigateur est incomplet.");
  await registerPushSubscription(row);
}

async function readState(): Promise<PushState> {
  const support = browserSupport();
  const sub = support.hasServiceWorker && support.hasPushManager ? await currentPushSubscription() : null;
  let mine = false;
  if (sub) {
    mine = await isMyPushSubscription(sub.endpoint);
    if (!mine) {
      // Abonnement orphelin ou d'autrui : on le retire, sans toucher à la base.
      try { await sub.unsubscribe(); } catch { /* le navigateur le retirera au prochain push */ }
    }
  }
  return resolvePushState({
    ...support,
    isApplePlatform: isApplePlatform(navigator.userAgent, navigator.platform, navigator.maxTouchPoints),
    isStandalone:
      window.matchMedia("(display-mode: standalone)").matches
      || (navigator as Navigator & { standalone?: boolean }).standalone === true,
    permission: support.hasNotification ? Notification.permission : "default",
    publicKey: PUBLIC_KEY,
    hasBrowserSubscription: Boolean(sub),
    rowIsMine: mine,
  });
}

async function enableDevicePush(): Promise<void> {
  const registration = await navigator.serviceWorker.register(SW_URL, { updateViaCache: "none" });
  await navigator.serviceWorker.ready;

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error(
      permission === "denied"
        ? "Les notifications sont bloquées pour ce site dans le navigateur."
        : "Autorisation non accordée.",
    );
  }

  const existing = await registration.pushManager.getSubscription();
  const sub = existing ?? await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(PUBLIC_KEY),
  });
  try {
    await registerRow(sub.toJSON());
  } catch (e) {
    // Pas de ligne en base ⇒ pas d'abonnement orphelin dans le navigateur.
    try { await sub.unsubscribe(); } catch { /* ignoré */ }
    throw e;
  }
}

export function usePushSubscription() {
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: pushKeys.device(userId),
    enabled: Boolean(userId),
    queryFn: readState,
    staleTime: 60_000,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: pushKeys.device(userId) });
  const enable = useMutation({ mutationFn: enableDevicePush, onSettled: invalidate });
  const disable = useMutation({ mutationFn: forgetDevicePush, onSettled: invalidate });

  const error = enable.error ?? disable.error ?? null;
  return {
    state: (query.data ?? "off") as PushState,
    loading: query.isPending,
    busy: enable.isPending || disable.isPending,
    error: error instanceof Error ? error.message : error ? String(error) : null,
    enable: () => enable.mutateAsync().catch(() => undefined),
    disable: () => disable.mutateAsync().catch(() => undefined),
  };
}

interface WorkerMessage {
  type?: string;
  url?: string;
  subscription?: SubscriptionJson;
}

/**
 * À monter UNE fois dans la zone authentifiée : touche `last_seen_at` de
 * l'appareil, et écoute le service worker — clic sur une notification quand
 * l'application est déjà ouverte (`clara:navigate`), renouvellement
 * d'abonnement par le navigateur (`clara:push-resubscribed`).
 * ⚠️ Keyé sur l'id utilisateur, jamais sur l'objet session : supabase-js
 * ré-émet une session à chaque retour d'onglet, ce qui détruirait et recréerait
 * l'écouteur en boucle (même piège que le canal realtime de la cloche).
 */
export function usePushBootstrap(): void {
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!userId || !browserSupport().hasServiceWorker) return;
    let cancelled = false;

    void (async () => {
      try {
        const sub = await currentPushSubscription();
        if (!sub || cancelled) return;
        await touchPushSubscription(sub.endpoint);
      } catch { /* décoratif */ }
    })();

    const onMessage = (event: MessageEvent<WorkerMessage>) => {
      const data = event.data;
      if (!data || typeof data !== "object") return;
      if (data.type === "clara:navigate" && typeof data.url === "string" && data.url.startsWith("/")) {
        navigate(data.url);
      } else if (data.type === "clara:push-resubscribed" && data.subscription) {
        void registerRow(data.subscription)
          .then(() => queryClient.invalidateQueries({ queryKey: pushKeys.device(userId) }))
          .catch(() => undefined);
      }
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener("message", onMessage);
    };
  }, [userId, navigate, queryClient]);
}

/** Composant nul : un seul point de montage dans la zone authentifiée. */
export function PushBootstrap(): null {
  usePushBootstrap();
  return null;
}
