// Merci Facteur — client réseau (Deno). La logique pure est dans
// `merciFacteurLogic.ts`. Secrets (jamais côté navigateur) :
//   MF_SERVICE_ID, MF_SECRET_KEY, MF_USER_ID, MF_AUTHORIZED_IP (défaut
//   « 111.111.111 », restriction d'IP levée par le support), MF_BASE_URL
//   (défaut : production).
import {
  buildSendCourrierBody,
  mfErrorText,
  mfSignature,
  type MfAttempt,
  type MfSendInput,
} from "./merciFacteurLogic.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
type Admin = SupabaseClient;

const DEFAULT_BASE = "https://www.merci-facteur.com/api/1.2/prod/service";
const PROVIDER = "merci_facteur";

export interface MfConfig {
  base: string;
  serviceId: string;
  secretKey: string;
  userId: string;
  authorizedIp: string;
}

/** La configuration, ou `null` si un secret manque (l'envoi est alors refusé proprement). */
export function mfConfig(): MfConfig | null {
  const serviceId = Deno.env.get("MF_SERVICE_ID");
  const secretKey = Deno.env.get("MF_SECRET_KEY");
  const userId = Deno.env.get("MF_USER_ID");
  if (!serviceId || !secretKey || !userId) return null;
  return {
    base: (Deno.env.get("MF_BASE_URL") || DEFAULT_BASE).replace(/\/+$/, ""),
    serviceId,
    secretKey,
    userId,
    authorizedIp: Deno.env.get("MF_AUTHORIZED_IP") || "111.111.111",
  };
}

/** Jeton valable 24 h, mis en cache dans `provider_tokens` (service role seul). */
export async function mfToken(admin: Admin, cfg: MfConfig, force = false): Promise<string> {
  if (!force) {
    const { data } = await admin
      .from("provider_tokens")
      .select("token, expire_at")
      .eq("provider", PROVIDER)
      .maybeSingle();
    if (data?.token && new Date(data.expire_at).getTime() > Date.now() + 120_000) return data.token as string;
  }
  const ts = Math.floor(Date.now() / 1000);
  const signature = await mfSignature(cfg.serviceId, cfg.secretKey, ts);
  const res = await fetch(`${cfg.base}/getToken`, {
    headers: {
      "ww-service-signature": signature,
      "ww-timestamp": String(ts),
      "ww-service-id": cfg.serviceId,
      "ww-authorized-ip": cfg.authorizedIp,
    },
    signal: AbortSignal.timeout(20_000),
  });
  const data = await res.json().catch(() => null);
  if (!data?.success || !data.token) {
    throw new Error(`Authentification auprès du prestataire impossible : ${mfErrorText(data?.error ?? `HTTP ${res.status}`)}`);
  }
  const expire = typeof data.expire === "number" ? new Date(data.expire * 1000) : new Date(Date.now() + 86_400_000);
  await admin.from("provider_tokens").upsert({
    provider: PROVIDER,
    token: data.token,
    expire_at: expire.toISOString(),
    updated_at: new Date().toISOString(),
  });
  return data.token as string;
}

/**
 * Une tentative de `sendCourrier`. Ne lève jamais : distingue la réponse
 * lisible (acceptée ou refusée — certitude) de l'issue inconnue (délai,
 * coupure, réponse illisible — le courrier a PU partir).
 */
export async function mfSendAttempt(cfg: MfConfig, token: string, input: MfSendInput): Promise<MfAttempt> {
  let res: Response;
  try {
    res = await fetch(`${cfg.base}/sendCourrier`, {
      method: "POST",
      headers: {
        "ww-access-token": token,
        "ww-service-id": cfg.serviceId,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: buildSendCourrierBody(input),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (e) {
    return { kind: "unknown", reason: (e as Error).name === "TimeoutError" ? "délai dépassé" : (e as Error).message };
  }
  let data: Record<string, unknown> | null = null;
  try {
    data = await res.json();
  } catch {
    return { kind: "unknown", reason: `réponse illisible (HTTP ${res.status})` };
  }
  if (data?.success === true) return { kind: "ok", data };
  return { kind: "refused", error: mfErrorText(data?.error ?? `HTTP ${res.status}`) };
}
