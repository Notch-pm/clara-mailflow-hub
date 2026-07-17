/**
 * Client HTTP vers l'API contacts du Socle (edge function `contacts-api`).
 * Même robustesse que sync-socle-referentiel : timeout 20 s, retries avec
 * backoff pour les requêtes idempotentes (GET uniquement — jamais les
 * écritures, risque de doublon), arrêt net sur 401/403 (clé invalide, révoquée
 * ou sans scope `contacts`).
 *
 * Réutilisé par `socle-contacts` (proxy pour le frontend) et
 * `extract-courier-info` (rapprochement de l'expéditeur par email).
 */
import {
  parseKeyMap,
  resolveApiKey,
  type SocleContactsRequest,
} from "./socleContactsLogic.ts";

/** Clé Socle refusée (401/403) — problème de configuration, pas d'utilisateur. */
export class SocleContactsAuthError extends Error {}

/** Erreur applicative renvoyée par contacts-api (400, 404, 409…). */
export class SocleContactsApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
  ) {
    super(message);
  }
}

const TIMEOUT_MS = 20_000;
const RETRY_DELAYS_MS = [1_000, 3_000, 9_000];

export function contactsApiBaseUrl(): string {
  return (
    Deno.env.get("SOCLE_CONTACTS_API_URL") ??
    "https://qhrokbkyxgcvkbpmbmna.supabase.co/functions/v1/contacts-api"
  ).replace(/\/+$/, "");
}

/**
 * Clé API contacts du tenant. Cible : UNE clé plateforme (SOCLE_API_KEY,
 * scopes read+contacts, non liée à une organisation) partagée par tous les
 * tenants — le Socle et Clara sont chacun multi-tenant, la liaison est unique.
 * La map par racine (SOCLE_CONTACTS_API_KEYS) reste prioritaire pendant la
 * transition ; on la retirera une fois la clé plateforme en place.
 */
export function contactsApiKeyForOrg(socleOrgId: string | null | undefined): string | null {
  if (!socleOrgId) return null;
  return (
    resolveApiKey(parseKeyMap(Deno.env.get("SOCLE_CONTACTS_API_KEYS")), socleOrgId) ??
    (Deno.env.get("SOCLE_API_KEY")?.trim() || null)
  );
}

function envelopeOf(body: unknown): { code: string; message: string } {
  const err = (body as { error?: { code?: string; message?: string } })?.error;
  return {
    code: typeof err?.code === "string" ? err.code : "unknown",
    message: typeof err?.message === "string" ? err.message : "Erreur API Socle.",
  };
}

/**
 * Exécute une requête vers contacts-api. Résout en `{ status, body }` pour les
 * réponses 2xx ; lève SocleContactsAuthError / SocleContactsApiError sinon.
 */
export async function fetchContactsApi(
  apiKey: string,
  request: SocleContactsRequest,
  opts: { socleOrgId?: string | null } = {},
): Promise<{ status: number; body: unknown }> {
  const url = `${contactsApiBaseUrl()}${request.path}`;
  const maxAttempts = request.idempotent ? RETRY_DELAYS_MS.length + 1 : 1;

  let lastError: unknown = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt - 1]));
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: request.method,
        headers: {
          Authorization: `Bearer ${apiKey.trim()}`,
          Accept: "application/json",
          // Tenant visé, pour une clé PLATEFORME (non liée à une organisation) :
          // le référentiel servi est celui de la RACINE de cette org. Une clé
          // liée à une organisation ignore cet en-tête.
          ...(opts.socleOrgId ? { "X-Organization-Id": opts.socleOrgId } : {}),
          ...(request.body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: request.body !== undefined ? JSON.stringify(request.body) : undefined,
        signal: controller.signal,
      });

      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        /* corps vide ou non JSON */
      }

      if (response.status === 401 || response.status === 403) {
        const { message } = envelopeOf(body);
        console.error(
          `[socle-contacts] ${response.status} Socle — clé préfixe="${apiKey.trim().slice(0, 12)}" : ${message}`,
        );
        throw new SocleContactsAuthError(message);
      }

      if (!response.ok) {
        const { code, message } = envelopeOf(body);
        if (response.status >= 500 && request.idempotent) {
          lastError = new SocleContactsApiError(message, response.status, code);
          console.warn(`[socle-contacts] ${request.path} tentative ${attempt + 1}: HTTP ${response.status}`);
          continue;
        }
        throw new SocleContactsApiError(message, response.status, code);
      }

      return { status: response.status, body };
    } catch (e) {
      if (e instanceof SocleContactsAuthError || e instanceof SocleContactsApiError) throw e;
      // Erreur réseau ou timeout.
      lastError = e;
      if (!request.idempotent) break;
      console.warn(
        `[socle-contacts] ${request.path} tentative ${attempt + 1} échouée: ${e instanceof Error ? e.message : e}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(
    `Référentiel de contacts injoignable (${request.path}): ${lastError instanceof Error ? lastError.message : lastError}`,
  );
}
