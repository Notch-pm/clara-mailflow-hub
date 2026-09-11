// Envoi Web Push — seule brique de ce dossier à dépendre du runtime Deno.
// Tout ce qui DÉCIDE (message, issue, configuration) vit dans les modules purs
// voisins, testés par vitest.
//
// Bibliothèque : `web-push` (chiffrement RFC 8291 + en-tête VAPID). Elle
// s'appuie sur `https` et `crypto` de Node, servis par la compatibilité Node du
// runtime Supabase. Si elle devait faire défaut, `jsr:@negrel/webpush`
// (WebCrypto + fetch) se substitue ICI, sans toucher au reste — c'est tout
// l'intérêt de l'isoler dans un fichier de quarante lignes.

import webpush from "npm:web-push@3.6.7";

import { PUSH_TTL_SECONDS, type VapidConfig } from "./config.ts";

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Résultat brut d'un envoi : le code HTTP du service de push, ou l'erreur. */
export interface PushSendResult {
  status: number | null;
  error?: string;
}

export async function sendPush(
  target: PushTarget,
  payload: string,
  vapid: VapidConfig,
): Promise<PushSendResult> {
  try {
    const res = await webpush.sendNotification(
      { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
      payload,
      {
        vapidDetails: { subject: vapid.subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey },
        TTL: PUSH_TTL_SECONDS,
        urgency: "normal",
      },
    );
    return { status: res.statusCode };
  } catch (e) {
    const status = typeof (e as { statusCode?: unknown })?.statusCode === "number"
      ? (e as { statusCode: number }).statusCode
      : null;
    const message = e instanceof Error ? e.message : String(e);
    // ⚠️ Jamais l'endpoint dans le message relayé : il identifie l'appareil, et
    // il finirait dans `notifications.push_error`, donc dans les journaux.
    return { status, error: message.replace(/https?:\/\/\S+/g, "<endpoint>").slice(0, 200) };
  }
}
