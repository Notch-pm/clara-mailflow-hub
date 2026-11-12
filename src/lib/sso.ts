// Connexion unique (lot 4 de l'annuaire des agents) : « Keycloak authentifie, le
// Socle autorise ». Le bouton envoie vers Keycloak (`https://auth.edilumen.fr`,
// realm `edilumen`, client `clara`), qui demande l'e-mail puis oriente vers l'annuaire de la
// collectivité (fonction « Organisations » de Keycloak : domaine d'e-mail →
// fournisseur d'identité). Aucune recherche côté Clara, aucun `kc_idp_hint`.
//
// Un agent authentifié mais non provisionné par le Socle est refusé par Supabase
// Auth (inscriptions fermées) : l'erreur revient dans l'URL de retour, lue ici.
// Voir docs/permissions.md (agents gérés par le Socle) et, côté Socle,
// docs/features/agents-et-acces.md (lot 4).

import type { SignInWithOAuthCredentials } from "@supabase/supabase-js";

/** Nom du provider dans Supabase Auth (Authentication → Providers → Keycloak). */
export const SSO_PROVIDER = "keycloak" as const;

/**
 * Options de `signInWithOAuth`. ⚠️ `scopes: "openid"` est obligatoire : sans lui,
 * le provider `keycloak` de Supabase ne demande que `profile email` et Keycloak
 * ≥ 25 refuse `userinfo` (403) — piège relevé au lab du 2026-10-30.
 */
export function ssoSignInCredentials(origin: string): SignInWithOAuthCredentials {
  return {
    provider: SSO_PROVIDER,
    options: { scopes: "openid", redirectTo: `${origin}/connexion` },
  };
}

export interface SsoReturnError {
  /** Message affiché à l'agent, en français. */
  message: string;
}

const NOT_PROVISIONED =
  "Votre compte n'a pas accès à Clara. Demandez à l'administrateur de votre collectivité de vous l'ouvrir.";
const SUSPENDED = "Votre compte est suspendu. Contactez l'administrateur de votre collectivité.";
const GENERIC =
  "La connexion avec le compte de votre collectivité n'a pas abouti. Réessayez, ou connectez-vous avec votre mot de passe.";

function paramsOf(search: string, hash: string): URLSearchParams {
  const merged = new URLSearchParams(search.replace(/^\?/, ""));
  new URLSearchParams(hash.replace(/^#/, "")).forEach((value, key) => {
    if (!merged.has(key)) merged.set(key, value);
  });
  return merged;
}

/**
 * Lit l'erreur que Supabase Auth renvoie au retour de Keycloak (dans la requête
 * ou le fragment selon le flux), ou `null` s'il n'y en a pas. Lecteur tolérant :
 * on reconnaît le code (`error_code`) et, à défaut, le texte de l'erreur.
 *
 * Au retour d'une tentative silencieuse (`silent`), seuls « non provisionné » et
 * « suspendu » s'affichent : le reste (`login_required`…) veut dire « pas de
 * session Keycloak », ce qui n'est pas une erreur.
 */
export function readSsoReturnError(
  search: string,
  hash: string,
  options: { silent?: boolean } = {},
): SsoReturnError | null {
  const params = paramsOf(search, hash);
  const error = params.get("error");
  const code = params.get("error_code") ?? "";
  const description = params.get("error_description") ?? "";
  if (!error && !code) return null;

  const text = `${code} ${description}`.toLowerCase();
  if (text.includes("signup_disabled") || text.includes("signups not allowed")) {
    return { message: NOT_PROVISIONED };
  }
  if (text.includes("banned")) {
    return { message: SUSPENDED };
  }
  return options.silent ? null : { message: GENERIC };
}

// ─── Connexion silencieuse ────────────────────────────────────────────────────
// Un agent déjà connecté à Keycloak par une autre application de la gamme
// (session « auth.edilumen.fr ») ne doit pas recliquer : en arrivant sur la page
// de connexion, on demande discrètement à Keycloak s'il a une session
// (`prompt=none`, standard OpenID Connect). Oui → retour connecté, sans écran.
// Non → Keycloak répond aussitôt `login_required`, et la page s'affiche
// normalement, sans message d'erreur.
//
// ⚠️ Une seule tentative par onglet (sessionStorage) : sans ce verrou, une
// déconnexion relancerait aussitôt la connexion, et un échec bouclerait.
// ⚠️ Lectures au rendu, écritures dans un effet (StrictMode rejoue les deux).

/** Clé sessionStorage : absente = jamais tenté, `pending` = parti vers Keycloak, `done`. */
export const SILENT_SSO_KEY = "edilumen.sso.silent";

export type SilentSsoStorage = Pick<Storage, "getItem" | "setItem">;

/** Le sessionStorage de l'onglet, ou `null` s'il est inaccessible (navigation restreinte). */
export function silentSsoStorage(): SilentSsoStorage | null {
  try {
    const storage = window.sessionStorage;
    storage.getItem(SILENT_SSO_KEY);
    return storage;
  } catch {
    return null;
  }
}

export interface SilentSsoState {
  /** Tenter la connexion silencieuse maintenant. */
  attempt: boolean;
  /** On revient d'une tentative silencieuse : une erreur « pas de session » se tait. */
  returning: boolean;
}

/** Décide, sans rien écrire, s'il faut tenter la connexion silencieuse. */
export function readSilentSso(
  storage: SilentSsoStorage | null,
  search: string,
  hash: string,
): SilentSsoState {
  if (!storage) return { attempt: false, returning: false };
  let value: string | null;
  try {
    value = storage.getItem(SILENT_SSO_KEY);
  } catch {
    return { attempt: false, returning: false };
  }
  if (value === "pending") return { attempt: false, returning: true };
  if (value) return { attempt: false, returning: false };
  const params = paramsOf(search, hash);
  const authResultInUrl = ["error", "error_code", "access_token", "code"].some((k) => params.has(k));
  return { attempt: !authResultInUrl, returning: false };
}

/** Note l'étape de la tentative (`pending` avant de partir, `done` au retour). */
export function markSilentSso(storage: SilentSsoStorage | null, value: "pending" | "done"): void {
  try {
    storage?.setItem(SILENT_SSO_KEY, value);
  } catch {
    // Stockage refusé : la tentative n'aura simplement pas lieu deux fois de suite.
  }
}

/** Mêmes options que le bouton, plus `prompt=none` : Keycloak ne montre aucun écran. */
export function ssoSilentSignInCredentials(origin: string): SignInWithOAuthCredentials {
  const credentials = ssoSignInCredentials(origin);
  return {
    ...credentials,
    options: { ...credentials.options, queryParams: { prompt: "none" } },
  };
}
