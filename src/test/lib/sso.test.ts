import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  hasKeycloakIdentity,
  isSupabaseSessionKey,
  SUPABASE_SESSION_KEY_PATTERN,
  keycloakLogoutUrl,
  markSilentSso,
  readSilentSso,
  readSsoReturnError,
  SILENT_SSO_KEY,
  ssoSignInCredentials,
  ssoSilentSignInCredentials,
  SSO_LOGOUT_PATH,
  SSO_PROVIDER,
  ssoLogoutRedirect,
} from "@/lib/sso";

describe("ssoSignInCredentials", () => {
  it("demande le provider keycloak avec le scope openid et revient sur /connexion", () => {
    expect(ssoSignInCredentials("https://clara.edilumen.fr")).toEqual({
      provider: "keycloak",
      options: { scopes: "openid", redirectTo: "https://clara.edilumen.fr/connexion" },
    });
    expect(SSO_PROVIDER).toBe("keycloak");
  });

  it("n'envoie aucun kc_idp_hint : Keycloak oriente lui-même par le domaine", () => {
    const creds = ssoSignInCredentials("http://localhost:5173");
    expect(JSON.stringify(creds)).not.toContain("kc_idp_hint");
  });
});

describe("readSsoReturnError", () => {
  it("rien dans l'URL → pas d'erreur", () => {
    expect(readSsoReturnError("", "")).toBeNull();
    expect(readSsoReturnError("?from=/courriers", "#access_token=abc")).toBeNull();
  });

  it("agent non provisionné (inscriptions fermées), par le code", () => {
    const err = readSsoReturnError(
      "?error=access_denied&error_code=signup_disabled&error_description=Signups+not+allowed+for+this+instance",
      "",
    );
    expect(err?.message).toMatch(/n'a pas accès à Clara/);
  });

  it("agent non provisionné, par le seul texte et dans le fragment", () => {
    const err = readSsoReturnError(
      "",
      "#error=server_error&error_description=Signups%20not%20allowed%20for%20this%20instance",
    );
    expect(err?.message).toMatch(/n'a pas accès à Clara/);
  });

  it("compte suspendu (banni par set_user_status)", () => {
    const err = readSsoReturnError("?error=access_denied&error_description=User+is+banned", "");
    expect(err?.message).toMatch(/suspendu/);
  });

  it("toute autre erreur → message générique qui propose le mot de passe", () => {
    const err = readSsoReturnError(
      "?error=invalid_request&error_description=Unsupported+provider%3A+provider+is+not+enabled",
      "",
    );
    expect(err?.message).toMatch(/mot de passe/);
  });

  it("un code sans `error` suffit à signaler l'échec", () => {
    expect(readSsoReturnError("?error_code=unexpected_failure", "")).not.toBeNull();
  });
});

describe("connexion silencieuse", () => {
  function memoryStorage(initial?: string) {
    const map = new Map<string, string>();
    if (initial) map.set(SILENT_SSO_KEY, initial);
    return {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      map,
    };
  }

  it("ajoute prompt=none aux options du bouton, sans rien d'autre", () => {
    const creds = ssoSilentSignInCredentials("https://app.edilumen.fr");
    const button = ssoSignInCredentials("https://app.edilumen.fr");
    expect(creds).toEqual({
      ...button,
      options: { ...button.options, queryParams: { prompt: "none" } },
    });
  });

  it("première arrivée de l'onglet → on tente", () => {
    expect(readSilentSso(memoryStorage(), "", "")).toEqual({ attempt: true, returning: false });
  });

  it("une seule tentative par onglet : déjà faite → on ne retente pas", () => {
    expect(readSilentSso(memoryStorage("done"), "", "")).toEqual({ attempt: false, returning: false });
  });

  it("retour d'une tentative → on ne retente pas, et on sait que c'en est un retour", () => {
    expect(readSilentSso(memoryStorage("pending"), "#error=login_required", "")).toEqual({
      attempt: false,
      returning: true,
    });
  });

  it("un résultat d'authentification dans l'URL → on ne tente pas", () => {
    for (const [search, hash] of [
      ["?error=access_denied", ""],
      ["?error_code=signup_disabled", ""],
      ["", "#access_token=abc"],
      ["?code=xyz", ""],
    ]) {
      expect(readSilentSso(memoryStorage(), search, hash).attempt).toBe(false);
    }
  });

  it("stockage inaccessible → jamais de tentative (pas de boucle possible)", () => {
    expect(readSilentSso(null, "", "")).toEqual({ attempt: false, returning: false });
    const throwing = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("SecurityError");
      },
    };
    expect(readSilentSso(throwing, "", "")).toEqual({ attempt: false, returning: false });
    expect(() => markSilentSso(throwing, "pending")).not.toThrow();
  });

  it("markSilentSso note l'étape", () => {
    const storage = memoryStorage();
    markSilentSso(storage, "pending");
    expect(storage.map.get(SILENT_SSO_KEY)).toBe("pending");
  });

  it("au retour silencieux, « pas de session » se tait…", () => {
    expect(
      readSsoReturnError("", "#error=login_required&error_description=Login+required", { silent: true }),
    ).toBeNull();
    expect(readSsoReturnError("?error=server_error", "", { silent: true })).toBeNull();
  });

  it("…mais « non provisionné » et « suspendu » s'affichent toujours", () => {
    expect(
      readSsoReturnError("?error=access_denied&error_code=signup_disabled", "", { silent: true }),
    ).not.toBeNull();
    expect(
      readSsoReturnError("?error=access_denied&error_description=User+is+banned", "", { silent: true })
        ?.message,
    ).toMatch(/suspendu/);
  });
});

describe("déconnexion unique", () => {
  const kcUser = { app_metadata: { providers: ["email", "keycloak"] } };

  it("reconnaît une identité Keycloak, et seulement elle", () => {
    expect(hasKeycloakIdentity(kcUser)).toBe(true);
    expect(hasKeycloakIdentity({ app_metadata: { providers: ["email"] } })).toBe(false);
    expect(hasKeycloakIdentity({ app_metadata: {} })).toBe(false);
    expect(hasKeycloakIdentity(null)).toBe(false);
  });

  it("construit l'adresse de déconnexion Keycloak avec le client et le retour", () => {
    const url = new URL(keycloakLogoutUrl("app", "https://app.edilumen.fr/login"));
    expect(`${url.origin}${url.pathname}`).toBe(
      "https://auth.edilumen.fr/realms/edilumen/protocol/openid-connect/logout",
    );
    expect(url.searchParams.get("client_id")).toBe("app");
    expect(url.searchParams.get("post_logout_redirect_uri")).toBe("https://app.edilumen.fr/login");
  });

  it("passe par Keycloak pour un compte relié, en https", () => {
    const target = ssoLogoutRedirect(kcUser, "app", "https://app.edilumen.fr", "/login");
    expect(target).toContain("/protocol/openid-connect/logout?client_id=app");
  });

  it("reste sur place pour un compte à mot de passe seul, ou en développement", () => {
    expect(
      ssoLogoutRedirect({ app_metadata: { providers: ["email"] } }, "app", "https://app.edilumen.fr", "/login"),
    ).toBeNull();
    expect(ssoLogoutRedirect(kcUser, "app", "http://localhost:5173", "/login")).toBeNull();
  });

  it("la page de déconnexion pour Keycloak a une adresse fixe (déclarée dans Keycloak)", () => {
    expect(SSO_LOGOUT_PATH).toBe("/deconnexion-sso");
  });
});

describe("page statique de déconnexion pour Keycloak", () => {
  const html = readFileSync(`${process.cwd()}/public/deconnexion-sso.html`, "utf8");

  it("reconnaît la clé de session supabase-js, et seulement elle", () => {
    expect(isSupabaseSessionKey("sb-abcdefghijkl-auth-token")).toBe(true);
    expect(isSupabaseSessionKey("sb-abcdefghijkl-auth-token-code-verifier")).toBe(false);
    expect(isSupabaseSessionKey("edilumen.sso.silent")).toBe(false);
    expect(isSupabaseSessionKey(null)).toBe(false);
  });

  it("efface avec le même motif que l'application", () => {
    expect(html).toContain(`/${SUPABASE_SESSION_KEY_PATTERN.source}/.test(key)`);
    expect(html).toContain("localStorage.removeItem(key)");
  });

  it("reste synchrone : aucun script chargé, aucune attente", () => {
    expect(html).not.toMatch(/<script[^>]*src=/);
    expect(html).not.toMatch(/await|setTimeout|fetch\(/);
  });
});
