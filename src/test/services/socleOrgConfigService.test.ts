import { describe, it, expect, beforeEach, vi } from "vitest";
import "../mocks/supabase";
import { mockSupabase } from "../mocks/supabase";

const { assignableOrgs, setOrgMembers, updateOrgConfig, setImapBoxOrganization } =
  await import("@/services/socleOrgConfigService");

const ORG_ID = "org-1";
const SOCLE_ORG_ID = "so-1";

function makeOrg(overrides: Record<string, unknown> = {}) {
  return {
    id: "so-1",
    organization_id: ORG_ID,
    socle_id: "s-1",
    socle_parent_id: null,
    name: "Direction du Cabinet",
    slug: null,
    type: null,
    status: "active",
    phone: null,
    email: null,
    address: null,
    logo_url: null,
    synced_at: "2026-07-11T18:00:00.000Z",
    obsoleted_at: null,
    workflow_id: "wf-1",
    reply_workflow_id: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("socleOrgConfigService", () => {
  describe("assignableOrgs", () => {
    it("exclut les organisations obsolètes (statut Socle ou disparues)", () => {
      const active = makeOrg();
      const obsoleteStatus = makeOrg({ id: "so-2", name: "B", status: "obsolete" });
      const obsoleteMirror = makeOrg({ id: "so-3", name: "C", obsoleted_at: "2026-07-01T00:00:00Z" });

      const result = assignableOrgs([active, obsoleteStatus, obsoleteMirror] as never);
      expect(result.map((o) => o.id)).toEqual(["so-1"]);
    });
  });

  describe("updateOrgConfig", () => {
    it("met à jour uniquement les workflows de l'organisation", async () => {
      const eq = vi.fn().mockResolvedValue({ error: null });
      const update = vi.fn().mockReturnValue({ eq });
      mockSupabase.from.mockReturnValue({ update });

      await updateOrgConfig(SOCLE_ORG_ID, { workflow_id: "wf-2", reply_workflow_id: null });

      expect(mockSupabase.from).toHaveBeenCalledWith("socle_organizations");
      expect(update).toHaveBeenCalledWith({ workflow_id: "wf-2", reply_workflow_id: null });
      expect(eq).toHaveBeenCalledWith("id", SOCLE_ORG_ID);
    });
  });

  describe("setImapBoxOrganization", () => {
    it("rattache une boîte à une org", async () => {
      const eq = vi.fn().mockResolvedValue({ error: null });
      const update = vi.fn().mockReturnValue({ eq });
      mockSupabase.from.mockReturnValue({ update });

      await setImapBoxOrganization("imap-1", SOCLE_ORG_ID);

      expect(mockSupabase.from).toHaveBeenCalledWith("imap_settings");
      expect(update).toHaveBeenCalledWith({ socle_organization_id: SOCLE_ORG_ID });
    });

    it("détache une boîte (null)", async () => {
      const eq = vi.fn().mockResolvedValue({ error: null });
      const update = vi.fn().mockReturnValue({ eq });
      mockSupabase.from.mockReturnValue({ update });

      await setImapBoxOrganization("imap-1", null);
      expect(update).toHaveBeenCalledWith({ socle_organization_id: null });
    });
  });

  describe("setOrgMembers", () => {
    it("calcule le diff : ajoute les nouveaux, retire les absents", async () => {
      const insert = vi.fn().mockResolvedValue({ error: null });
      const deleteIn = vi.fn().mockResolvedValue({ error: null });
      const deleteEq = vi.fn().mockReturnValue({ in: deleteIn });
      const del = vi.fn().mockReturnValue({ eq: deleteEq });
      // 1er appel : lecture des membres existants (u1, u2) ; puis insert/delete
      mockSupabase.from
        .mockReturnValueOnce({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: [{ user_id: "u1" }, { user_id: "u2" }],
              error: null,
            }),
          }),
        })
        .mockReturnValueOnce({ insert })
        .mockReturnValueOnce({ delete: del });

      // Cible : u2 (conservé), u3 (ajouté) — u1 retiré
      await setOrgMembers(ORG_ID, SOCLE_ORG_ID, ["u2", "u3"]);

      expect(insert).toHaveBeenCalledWith([
        { organization_id: ORG_ID, socle_organization_id: SOCLE_ORG_ID, user_id: "u3" },
      ]);
      expect(deleteIn).toHaveBeenCalledWith("user_id", ["u1"]);
    });
  });
});
