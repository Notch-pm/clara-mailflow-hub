/**
 * Authentification Hawk (HMAC-SHA256) et utilitaires HTTP partagés par les 4
 * edge functions Arpège (create-arpege-demande, check-arpege-ticket-status,
 * sync-arpege-services, test-arpege-connection). Web Crypto uniquement
 * (`crypto.subtle`) — pas d'API Deno — donc importable aussi bien par ces
 * fonctions que par Vitest (testé dans src/test/arpege-shared.test.ts).
 *
 * Ce module NE couvre PAS l'autorisation applicative (membership, rôle,
 * superadmin, secret cron...) : chaque edge function garde ses propres
 * vérifications, qui diffèrent délibérément d'une fonction à l'autre.
 */

// ── Primitives cryptographiques ──

export function generateNonce(length = 6): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

export async function hmacSha256(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

export async function sha256(data: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(hash)));
}

// ── En-tête Hawk ──

export interface HawkHeaderInput {
  url: string;
  method: string;
  id: string;
  key: string;
  /** Horodatage Hawk (secondes epoch) ; injecté pour un test déterministe. */
  ts: string;
  /** Nonce Hawk ; injecté pour un test déterministe. */
  nonce: string;
  contentType?: string;
  payload?: string;
}

/**
 * Fonction pure : construit l'en-tête `Authorization: Hawk ...` à partir d'un
 * `ts`/`nonce` fournis par l'appelant. Aucun accès horloge/aléatoire — c'est
 * ce qui la rend testable de façon déterministe (voir `buildHawkHeader`
 * ci-dessous pour l'usage en production, qui génère `ts`/`nonce`).
 */
export async function buildHawkAuthorizationHeader(input: HawkHeaderInput): Promise<string> {
  const { url, method, id, key, ts, nonce, contentType = "", payload = "" } = input;
  const u = new URL(url);
  const resource = u.pathname + u.search;
  const port = u.port || (u.protocol === "https:" ? "443" : "80");
  const payloadHashInput = `hawk.1.payload\n${contentType}\n${payload}\n`;
  const hash = await sha256(payloadHashInput);
  const normalized = `hawk.1.header\n${ts}\n${nonce}\n${method.toUpperCase()}\n${resource}\n${u.hostname}\n${port}\n${hash}\n\n`;
  const mac = await hmacSha256(key, normalized);
  return `Hawk id="${id}", ts="${ts}", nonce="${nonce}", hash="${hash}", mac="${mac}"`;
}

/**
 * Construit l'en-tête Hawk pour un appel réel : génère `ts` (horloge) et
 * `nonce` (aléatoire) puis délègue à `buildHawkAuthorizationHeader`.
 * `contentType`/`payload` vides reproduisent le hash `hawk.1.payload\n\n\n`
 * utilisé par les appels GET sans corps (comportement d'origine des 4
 * fonctions Arpège).
 */
export async function buildHawkHeader(
  url: string,
  method: string,
  id: string,
  key: string,
  contentType = "",
  payload = "",
): Promise<string> {
  return buildHawkAuthorizationHeader({
    url,
    method,
    id,
    key,
    ts: Math.floor(Date.now() / 1000).toString(),
    nonce: generateNonce(),
    contentType,
    payload,
  });
}

// ── Identifiants Hawk ──

export interface ArpegeIntegrationCredentialsRow {
  client_id?: string | null;
  client_secret?: string | null;
  access_token?: string | null;
}

/**
 * Résout les identifiants Hawk depuis une ligne `organization_integrations`.
 * Règle conservée telle quelle : `client_id`/`client_secret` priment, avec
 * repli sur `access_token` — une ligne prod legacy pourrait ne dépendre que
 * de ce champ. Chaîne vide si l'identifiant est introuvable ; c'est à
 * l'appelant de décider de la réponse d'erreur (400 explicite sur les
 * endpoints "actifs", ignoré silencieusement sur check-status).
 */
export function resolveHawkCredentials(
  row: ArpegeIntegrationCredentialsRow,
): { hawkId: string; hawkKey: string } {
  return {
    hawkId: row.client_id || row.access_token || "",
    hawkKey: row.client_secret || row.access_token || "",
  };
}

// ── Appel HTTP signé ──

export interface FetchWithHawkOptions {
  onHttpError?: (status: number, url: string) => void;
  onApiError?: (data: any) => void;
}

/**
 * Appel GET signé Hawk. Renvoie `null` sur échec HTTP ou réponse Arpège
 * `IsSuccess: false`. Silencieux par défaut (comportement de référence :
 * create-arpege-demande) ; `options.onHttpError`/`onApiError` permettent de
 * reproduire le logging existant d'un appelant sans dupliquer cette fonction.
 */
export async function fetchWithHawk(
  url: string,
  id: string,
  key: string,
  options: FetchWithHawkOptions = {},
): Promise<any | null> {
  const authHeader = await buildHawkHeader(url, "GET", id, key);
  const response = await fetch(url, {
    headers: { Authorization: authHeader, Accept: "application/json" },
  });
  if (!response.ok) {
    options.onHttpError?.(response.status, url);
    return null;
  }
  const data = await response.json();
  if (data?.IsSuccess === false) {
    options.onApiError?.(data);
    return null;
  }
  return data;
}

/**
 * Extrait un tableau d'éléments d'une réponse Arpège, quel que soit
 * l'enveloppe (`Data.Results` / `Data.results` / `Data` / racine déjà un
 * tableau). Référence : create-arpege-demande (voir compte-rendu pour la
 * divergence avec l'ancienne version de sync-arpege-services).
 */
export function extractArray(data: any): any[] {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.Data?.Results)) return data.Data.Results;
  if (Array.isArray(data?.Data?.results)) return data.Data.results;
  if (Array.isArray(data?.Data)) return data.Data;
  return [];
}

// ── Résolution d'URL ──

/**
 * Normalise l'URL de base Arpège : retire les `/` de fin, et préfixe par le
 * domaine espace-citoyens si la valeur stockée n'est pas déjà une URL
 * absolue (certaines intégrations ne stockent qu'un chemin relatif).
 */
export function resolveArpegeUrl(apiBaseUrl: string): string {
  let base = apiBaseUrl.replace(/\/+$/, "");
  if (!base.startsWith("http")) {
    base = `https://www.espace-citoyens.net${base.startsWith("/") ? "" : "/"}${base}`;
  }
  return base;
}
