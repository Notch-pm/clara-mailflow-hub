// Notifications push sur l'appareil — module PUR (aucun DOM, aucun réseau),
// testé. Le hook `usePushSubscription` lit le navigateur et applique ces
// règles ; le composant `PushDeviceToggle` n'affiche que l'état.
//
// Un abonnement push est l'affaire d'UN appareil et d'UN navigateur : ce n'est
// pas une préférence de compte. Activer sur le téléphone n'active pas sur le
// poste de bureau, et c'est voulu — on veut être prévenu là où on n'est PAS
// devant Clara.
//
// Le push SUIT la cloche : ce qui apparaît dans `notifications` est poussé ici.
// Aucun réglage par type d'événement (la règle vit dans le trigger
// `notifications_push_queue`, côté base, et nulle part ailleurs).

export type PushState =
  /** Ni service worker, ni PushManager, ni Notification : navigateur trop ancien. */
  | "unsupported"
  /** iPhone / iPad hors application installée : Safari n'ouvre le push qu'à l'écran d'accueil. */
  | "needs_install"
  /** `VITE_VAPID_PUBLIC_KEY` absente de ce déploiement. */
  | "not_configured"
  /** L'agent a bloqué les notifications pour ce site dans le navigateur. */
  | "denied"
  | "off"
  | "on";

export interface PushEnv {
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
  /** Détection de CAPACITÉ (Safari iOS ne pousse qu'en app installée), pas de layout. */
  isApplePlatform: boolean;
  /** Ouvert depuis l'icône de l'écran d'accueil (`display-mode: standalone`). */
  isStandalone: boolean;
  permission: "default" | "granted" | "denied";
  publicKey: string;
  /** Le navigateur détient un abonnement pour cette origine. */
  hasBrowserSubscription: boolean;
  /** Cet abonnement est enregistré en base pour MON compte. */
  rowIsMine: boolean;
}

export function resolvePushState(env: PushEnv): PushState {
  if (!env.hasServiceWorker || !env.hasPushManager || !env.hasNotification) {
    return env.isApplePlatform && !env.isStandalone ? "needs_install" : "unsupported";
  }
  if (env.publicKey.trim() === "") return "not_configured";
  if (env.permission === "denied") return "denied";
  if (env.hasBrowserSubscription && env.rowIsMine) return "on";
  return "off";
}

/** Textes par état. */
export const PUSH_COPY: Record<PushState, { hint: string }> = {
  on: { hint: "Vous recevez les notifications de Clara sur cet appareil, même l'application fermée." },
  off: { hint: "Recevez les notifications de Clara sur cet appareil, même l'application fermée." },
  denied: {
    hint: "Les notifications sont bloquées pour ce site dans les réglages du navigateur. Autorisez-les, puis réessayez.",
  },
  needs_install: {
    hint: "Sur iPhone et iPad, ajoutez d'abord Clara à l'écran d'accueil (Partager › Sur l'écran d'accueil), puis ouvrez-la depuis cette icône.",
  },
  unsupported: { hint: "Ce navigateur ne prend pas en charge les notifications." },
  not_configured: { hint: "Les notifications sur appareil ne sont pas configurées sur cette instance." },
};

export const PUSH_FOOTNOTE =
  "Ce réglage vaut pour cet appareil et ce navigateur uniquement. Vous recevrez les mêmes événements que dans la cloche.";

/** Clé publique VAPID (base64url) → octets, tels que `pushManager.subscribe` les attend. */
export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized);
  // `new ArrayBuffer` explicite : `pushManager.subscribe` exige un BufferSource
  // adossé à un ArrayBuffer (pas un SharedArrayBuffer) depuis TypeScript 5.7.
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export interface SubscriptionJson {
  endpoint?: string | null;
  keys?: { p256dh?: string | null; auth?: string | null } | null;
}

export interface SubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent: string;
}

/** Ce que `PushSubscription.toJSON()` rend → ce que la RPC attend ; `null` si incomplet. */
export function subscriptionToRow(sub: SubscriptionJson, userAgent: string): SubscriptionRow | null {
  const endpoint = sub.endpoint?.trim() ?? "";
  const p256dh = sub.keys?.p256dh?.trim() ?? "";
  const auth = sub.keys?.auth?.trim() ?? "";
  if (!endpoint.startsWith("https://") || p256dh === "" || auth === "") return null;
  return { endpoint, p256dh, auth, user_agent: deviceLabel(userAgent) };
}

/** « Android · Chrome », « iPhone · Safari », « Windows · Edge »… pour l'affichage seul. */
export function deviceLabel(userAgent: string): string {
  const ua = userAgent;
  const os = /iPhone/.test(ua) ? "iPhone"
    : /iPad/.test(ua) ? "iPad"
    : /Android/.test(ua) ? "Android"
    : /Windows/.test(ua) ? "Windows"
    : /Mac OS X|Macintosh/.test(ua) ? "Mac"
    : /Linux/.test(ua) ? "Linux"
    : "Appareil";
  const browser = /Edg\//.test(ua) ? "Edge"
    : /OPR\//.test(ua) ? "Opera"
    : /SamsungBrowser/.test(ua) ? "Samsung Internet"
    : /Firefox\//.test(ua) ? "Firefox"
    : /Chrome\/|CriOS\//.test(ua) ? "Chrome"
    : /Safari\//.test(ua) ? "Safari"
    : "navigateur";
  return `${os} · ${browser}`.slice(0, 200);
}

/** iPhone / iPad — y compris l'iPad qui se présente en Mac (`maxTouchPoints > 1`). */
export function isApplePlatform(userAgent: string, platform: string, maxTouchPoints: number): boolean {
  return /iPad|iPhone|iPod/.test(userAgent) || (platform === "MacIntel" && maxTouchPoints > 1);
}
