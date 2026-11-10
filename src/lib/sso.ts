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
 */
export function readSsoReturnError(search: string, hash: string): SsoReturnError | null {
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
  return { message: GENERIC };
}
