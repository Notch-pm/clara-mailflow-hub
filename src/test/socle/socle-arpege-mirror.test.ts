import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  arpegeMirrorArgs,
  arpegePlan,
  arpegeWarning,
  type ArpegeTenantRef,
  type SocleIntegrationDto,
} from "../../../supabase/functions/sync-socle-referentiel/arpege";

// La configuration Arpège vient du Socle
// (GET /v1/organizations/{id}/integrations/arpege) et Clara n'en tient qu'un
// miroir. Ce module décide, pour une réponse 200, de recopier la déclaration
// ou de SUSPENDRE la ligne (identifiants conservés : une interface suspendue
// suit encore les demandes déjà déposées, décision PO L5). Les réponses
// non-200 laissent la ligne en l'état, avec un avertissement.

const TENANT: ArpegeTenantRef = {
  organizationId: "11111111-1111-1111-1111-111111111111",
  organizationName: "ACCM",
  rootSocleOrgId: "22222222-2222-2222-2222-222222222222",
};

const COMPLET: SocleIntegrationDto = {
  integration: "arpege",
  configured: true,
  is_active: true,
  settings: {
    api_base_url: " https://api.espace-citoyens.net/accm ",
    api_url_ticketingapp: "https://agent.example.test",
    client_id: "cid",
  },
  secrets: { client_secret: " s3cret ", access_token: "legacy" },
  updated_at: "2026-10-02T15:00:00Z",
};

describe("arpegeMirrorArgs", () => {
  it("déclaration complète → arguments de la RPC, secrets non élagués", () => {
    expect(arpegeMirrorArgs(TENANT, COMPLET)).toEqual({
      p_org_id: TENANT.organizationId,
      p_socle_org_id: TENANT.rootSocleOrgId,
      p_api_base_url: "https://api.espace-citoyens.net/accm",
      p_api_url_ticketingapp: "https://agent.example.test",
      p_client_id: "cid",
      p_client_secret: " s3cret ",
      p_access_token: "legacy",
      p_is_active: true,
      p_socle_updated_at: "2026-10-02T15:00:00Z",
    });
  });

  it("rien de déclaré, ou configured: false → null (pas de recopie)", () => {
    expect(arpegeMirrorArgs(TENANT, null)).toBeNull();
    expect(arpegeMirrorArgs(TENANT, { configured: false, settings: {}, secrets: {} })).toBeNull();
  });

  it("sans URL, ou sans de quoi signer → null", () => {
    expect(arpegeMirrorArgs(TENANT, { ...COMPLET, settings: { client_id: "cid" } })).toBeNull();
    expect(
      arpegeMirrorArgs(TENANT, { ...COMPLET, secrets: {} }),
    ).toBeNull();
  });

  it("jeton seul (ancien mode) : exploitable", () => {
    const args = arpegeMirrorArgs(TENANT, {
      ...COMPLET,
      settings: { api_base_url: "https://x.test" },
      secrets: { access_token: "legacy" },
    });
    expect(args).toMatchObject({ p_client_id: null, p_client_secret: null, p_access_token: "legacy" });
  });

  it("suspendue au Socle, ou is_active absent → inactive", () => {
    expect(arpegeMirrorArgs(TENANT, { ...COMPLET, is_active: false })?.p_is_active).toBe(false);
    expect(arpegeMirrorArgs(TENANT, { ...COMPLET, is_active: undefined })?.p_is_active).toBe(false);
  });
});

describe("arpegePlan (fin de la transition)", () => {
  it("déclaration complète → recopier", () => {
    const plan = arpegePlan(TENANT, COMPLET);
    expect(plan.action).toBe("recopier");
    expect(plan.action === "recopier" && plan.args.p_api_base_url).toBe("https://api.espace-citoyens.net/accm");
  });

  it("configured: false → suspendre, sans avertissement (état normal)", () => {
    expect(arpegePlan(TENANT, { integration: "arpege", configured: false, settings: {}, secrets: {} })).toEqual({
      action: "suspendre",
      warning: null,
    });
    expect(arpegePlan(TENANT, null)).toEqual({ action: "suspendre", warning: null });
  });

  it("configured: true mais inexploitable → suspendre, avec un avertissement sans secret", () => {
    const plan = arpegePlan(TENANT, {
      ...COMPLET,
      settings: { client_id: "cid" },
      secrets: { client_secret: "s3cret", access_token: "jeton-secret" },
    });
    expect(plan.action).toBe("suspendre");
    const warning = plan.action === "suspendre" ? plan.warning : null;
    expect(warning).toContain("ACCM");
    expect(warning).toContain("suspendue");
    expect(warning).not.toMatch(/s3cret|jeton-secret|cid/);
  });
});

describe("arpegeWarning", () => {
  it("dit quoi faire, sans jamais porter de secret", () => {
    expect(arpegeWarning(TENANT, 403)).toContain("scope « integrations »");
    expect(arpegeWarning(TENANT, 404)).toContain("hors périmètre");
    expect(arpegeWarning(TENANT, 500)).toContain("inchangée");
  });
});

describe("sync-socle-referentiel — aucun secret Arpège dans les journaux", () => {
  const source = readFileSync(
    join(__dirname, "../../../supabase/functions/sync-socle-referentiel/index.ts"),
    "utf8",
  );
  it("aucun console.* ne mentionne les arguments ou la réponse Arpège", () => {
    const logs = source.match(/console\.\w+\([^;]*\);/g) ?? [];
    for (const line of logs) {
      expect(line).not.toMatch(/arpegeArgs|arpegeDto|plan\.args|\bdto\b|client_secret|access_token|p_client_secret/);
    }
  });

  it("la suspension passe par la RPC de service, jamais par une écriture directe", () => {
    expect(source).toContain('rpc("suspend_arpege_integration_from_socle"');
    expect(source).not.toMatch(/from\("organization_integrations"\)\s*\.(update|upsert|insert|delete)/);
  });
});
