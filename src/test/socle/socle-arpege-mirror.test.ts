import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  arpegeMirrorArgs,
  arpegeWarning,
  type ArpegeTenantRef,
  type SocleIntegrationDto,
} from "../../../supabase/functions/sync-socle-referentiel/arpege";

// La configuration Arpège vient du Socle
// (GET /v1/organizations/{id}/integrations/arpege) et Clara n'en tient qu'un
// miroir. Ce module décide d'une seule chose : la déclaration est-elle
// exploitable ? Si non, l'appelant laisse la ligne locale EN L'ÉTAT
// (transition : les configurations saisies dans Clara survivent).

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

  it("rien de déclaré, ou configured: false → null (ligne locale conservée)", () => {
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
      expect(line).not.toMatch(/arpegeArgs|arpegeDto|client_secret|access_token|p_client_secret/);
    }
  });
});
