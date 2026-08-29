import { describe, expect, it } from "vitest";
import {
  DEFAULT_SMTP_PORT,
  smtpMirrorArgs,
  smtpRootUnknownWarning,
  smtpWarning,
  type SmtpTenantRef,
  type SocleSmtpDto,
} from "../../../supabase/functions/sync-socle-referentiel/smtp";

// Le serveur d'envoi vient du Socle (GET /v1/organizations/{id}/smtp) et Clara
// n'en tient qu'un miroir. Ce module décide d'une seule chose : la déclaration
// du Socle est-elle exploitable ? Si non, l'appelant efface le miroir — Clara
// n'ayant aucun relais de repli, mieux vaut ne rien envoyer qu'expédier avec
// une configuration bancale.

const TENANT: SmtpTenantRef = {
  organizationId: "11111111-1111-1111-1111-111111111111",
  organizationName: "ACCM",
  rootSocleOrgId: "22222222-2222-2222-2222-222222222222",
};

const COMPLET: SocleSmtpDto = {
  organization_id: "22222222-2222-2222-2222-222222222222",
  configured: true,
  host: "in-v3.mailjet.com",
  port: 587,
  username: "identifiant",
  password: "secret",
  from_email: "contact@notch.pm",
  from_name: "Notch",
  use_tls: true,
  updated_at: "2026-07-11T11:42:08Z",
};

describe("smtpMirrorArgs — déclaration exploitable", () => {
  it("transpose une déclaration complète vers les arguments de la RPC", () => {
    expect(smtpMirrorArgs(TENANT, COMPLET)).toEqual({
      p_org_id: TENANT.organizationId,
      p_socle_org_id: TENANT.rootSocleOrgId,
      p_host: "in-v3.mailjet.com",
      p_port: 587,
      p_username: "identifiant",
      p_password: "secret",
      p_from_email: "contact@notch.pm",
      p_from_name: "Notch",
      p_use_tls: true,
      p_socle_updated_at: "2026-07-11T11:42:08Z",
    });
  });

  it("écrit la RACINE Socle, pas l'organisation du tenant", () => {
    // Un tenant mappé sur une sous-organisation hérite du relais de sa racine :
    // c'est la racine qui doit être tracée comme provenance.
    const sousOrg: SmtpTenantRef = { ...TENANT, organizationName: "Marie d'Arles" };
    expect(smtpMirrorArgs(sousOrg, COMPLET)?.p_socle_org_id).toBe(TENANT.rootSocleOrgId);
  });

  it("élague hôte, identifiant et nom, et normalise l'adresse d'expédition", () => {
    const args = smtpMirrorArgs(TENANT, {
      ...COMPLET,
      host: "  in-v3.mailjet.com  ",
      username: "  identifiant  ",
      from_email: "  Contact@Notch.PM ",
      from_name: "  Notch  ",
    });
    expect(args?.p_host).toBe("in-v3.mailjet.com");
    expect(args?.p_username).toBe("identifiant");
    expect(args?.p_from_email).toBe("contact@notch.pm");
    expect(args?.p_from_name).toBe("Notch");
  });

  it("n'élague JAMAIS le mot de passe : une espace peut en faire partie", () => {
    expect(smtpMirrorArgs(TENANT, { ...COMPLET, password: "  a b  " })?.p_password).toBe("  a b  ");
  });

  it("rend une chaîne vide (jamais null) pour les champs facultatifs absents", () => {
    // Les colonnes de smtp_settings sont `not null default ''`.
    const args = smtpMirrorArgs(TENANT, {
      ...COMPLET,
      username: null,
      password: null,
      from_name: undefined,
    });
    expect(args?.p_username).toBe("");
    expect(args?.p_password).toBe("");
    expect(args?.p_from_name).toBe("");
  });

  it("retombe sur 587 quand le port est absent, nul ou hors bornes", () => {
    for (const port of [undefined, null, 0, -1, 70000, 1.5, Number.NaN] as unknown[]) {
      expect(smtpMirrorArgs(TENANT, { ...COMPLET, port: port as number })?.p_port).toBe(
        DEFAULT_SMTP_PORT,
      );
    }
    expect(smtpMirrorArgs(TENANT, { ...COMPLET, port: 465 })?.p_port).toBe(465);
  });

  it("chiffre par défaut : use_tls absent vaut true, seul false le désactive", () => {
    expect(smtpMirrorArgs(TENANT, { ...COMPLET, use_tls: undefined })?.p_use_tls).toBe(true);
    expect(smtpMirrorArgs(TENANT, { ...COMPLET, use_tls: null })?.p_use_tls).toBe(true);
    expect(smtpMirrorArgs(TENANT, { ...COMPLET, use_tls: false })?.p_use_tls).toBe(false);
  });

  it("laisse la date Socle à null quand elle est absente ou vide", () => {
    expect(smtpMirrorArgs(TENANT, { ...COMPLET, updated_at: null })?.p_socle_updated_at).toBeNull();
    expect(smtpMirrorArgs(TENANT, { ...COMPLET, updated_at: "   " })?.p_socle_updated_at).toBeNull();
  });

  it("tolère les champs inconnus du contrat (politique de compatibilité v1)", () => {
    const args = smtpMirrorArgs(TENANT, {
      ...COMPLET,
      nouveau_champ: "valeur",
    } as SocleSmtpDto & { nouveau_champ: string });
    expect(args?.p_host).toBe("in-v3.mailjet.com");
  });
});

describe("smtpMirrorArgs — refus (le miroir doit être effacé)", () => {
  it("refuse une absence de déclaration", () => {
    expect(smtpMirrorArgs(TENANT, null)).toBeNull();
    expect(smtpMirrorArgs(TENANT, undefined)).toBeNull();
  });

  it("refuse `configured: false` — c'est une déclaration d'absence, pas une erreur", () => {
    expect(
      smtpMirrorArgs(TENANT, {
        organization_id: TENANT.rootSocleOrgId,
        configured: false,
        host: null,
        port: null,
        username: null,
        password: null,
        from_email: null,
        from_name: null,
        use_tls: null,
        updated_at: null,
      }),
    ).toBeNull();
  });

  it("refuse `configured` absent : rien ne dit que le relais est utilisable", () => {
    expect(smtpMirrorArgs(TENANT, { ...COMPLET, configured: undefined })).toBeNull();
  });

  it("refuse un hôte manquant ou fait d'espaces", () => {
    expect(smtpMirrorArgs(TENANT, { ...COMPLET, host: null })).toBeNull();
    expect(smtpMirrorArgs(TENANT, { ...COMPLET, host: "   " })).toBeNull();
  });

  it("refuse une adresse d'expédition absente ou qui n'est pas une adresse", () => {
    for (const from of [null, "", "   ", "pas-une-adresse", "a@b", "a b@c.fr"]) {
      expect(smtpMirrorArgs(TENANT, { ...COMPLET, from_email: from })).toBeNull();
    }
  });

  it("refuse une déclaration incohérente : configured vrai mais tout est vide", () => {
    expect(
      smtpMirrorArgs(TENANT, { ...COMPLET, configured: true, host: "", from_email: "" }),
    ).toBeNull();
  });
});

describe("avertissements", () => {
  it("dit quoi faire sur un 403 (scope smtp absent de la clé)", () => {
    const w = smtpWarning(TENANT, 403);
    expect(w).toContain("ACCM");
    expect(w).toContain("smtp");
    expect(w).toContain("miroir inchangé");
  });

  it("distingue le 404 (hors périmètre ou API antérieure à la route)", () => {
    expect(smtpWarning(TENANT, 404)).toContain("hors périmètre");
  });

  it("reste explicite sur un statut inattendu", () => {
    expect(smtpWarning(TENANT, 500)).toContain("500");
  });

  it("signale une racine introuvable dans le périmètre de la clé", () => {
    const w = smtpRootUnknownWarning("Test 2", "33333333-3333-3333-3333-333333333333");
    expect(w).toContain("Test 2");
    expect(w).toContain("33333333-3333-3333-3333-333333333333");
  });

  it("ne laisse jamais fuir le mot de passe dans un avertissement", () => {
    for (const status of [403, 404, 500]) {
      expect(smtpWarning(TENANT, status)).not.toContain(COMPLET.password);
    }
  });
});
