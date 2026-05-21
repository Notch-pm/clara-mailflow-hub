import { describe, it, expect, beforeEach, vi } from "vitest";
import "../mocks/supabase";
import { mockSupabase } from "../mocks/supabase";

const { getOrgMembers, getOrgMember, updateOrgMember, deactivateOrgMember, reactivateOrgMember } =
  await import("@/services/userService");

function makeChain(resolved = { data: null, error: null }) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  const self = () => chain;
  const methods = ["update", "eq", "select", "order", "limit", "maybeSingle"];
  for (const m of methods) {
    chain[m] = vi.fn(self);
  }
  chain.then = vi.fn((resolve: (v: unknown) => unknown) =>
    Promise.resolve(resolved).then(resolve)
  );
  return chain;
}

const ORG_ID = "org-1";
const USER_ID = "user-1";
const MEMBERSHIP_ID = "mem-1";

const fakeRow = {
  id: MEMBERSHIP_ID,
  role: "gestionnaire",
  is_active: true,
  user_id: USER_ID,
  users: {
    id: USER_ID,
    email: "jean@example.com",
    first_name: "Jean",
    last_name: "Dupont",
    is_active: true,
    avatar_url: null,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("userService", () => {
  describe("getOrgMembers", () => {
    it("retourne un tableau vide si aucune donnée", async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: null, error: null }),
      });
      const result = await getOrgMembers(ORG_ID);
      expect(result).toEqual([]);
    });

    it("transforme correctement une row en OrgMember", async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: [fakeRow], error: null }),
      });
      const [member] = await getOrgMembers(ORG_ID);
      expect(member.id).toBe(USER_ID);
      expect(member.email).toBe("jean@example.com");
      expect(member.first_name).toBe("Jean");
      expect(member.role).toBe("gestionnaire");
      expect(member.membership_id).toBe(MEMBERSHIP_ID);
      expect(member.membership_active).toBe(true);
    });

    it("propage les erreurs Supabase", async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: null, error: new Error("DB error") }),
      });
      await expect(getOrgMembers(ORG_ID)).rejects.toThrow("DB error");
    });
  });

  describe("getOrgMember", () => {
    it("retourne null si l'utilisateur n'existe pas", async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      });
      const result = await getOrgMember(ORG_ID, USER_ID);
      expect(result).toBeNull();
    });

    it("retourne l'OrgMember correctement transformé", async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: fakeRow, error: null }),
      });
      const member = await getOrgMember(ORG_ID, USER_ID);
      expect(member?.email).toBe("jean@example.com");
      expect(member?.membership_id).toBe(MEMBERSHIP_ID);
    });
  });

  describe("updateOrgMember", () => {
    it("ne fait aucune requête si aucun champ à mettre à jour", async () => {
      await updateOrgMember(ORG_ID, USER_ID, MEMBERSHIP_ID, {});
      expect(mockSupabase.from).not.toHaveBeenCalled();
    });

    it("met à jour uniquement la table users si first_name change", async () => {
      mockSupabase.from.mockReturnValue(makeChain());

      await updateOrgMember(ORG_ID, USER_ID, MEMBERSHIP_ID, { first_name: "Pierre" });
      expect(mockSupabase.from).toHaveBeenCalledWith("users");
      expect(mockSupabase.from).not.toHaveBeenCalledWith("organization_users");
    });

    it("met à jour uniquement organization_users si role change", async () => {
      const fakeChain = makeChain();
      mockSupabase.from.mockReturnValue(fakeChain);

      await updateOrgMember(ORG_ID, USER_ID, MEMBERSHIP_ID, { role: "administrateur" });
      expect(mockSupabase.from).toHaveBeenCalledWith("organization_users");
      expect(mockSupabase.from).not.toHaveBeenCalledWith("users");
    });

    it("met à jour les deux tables si is_active change", async () => {
      mockSupabase.from.mockReturnValue(makeChain());

      await updateOrgMember(ORG_ID, USER_ID, MEMBERSHIP_ID, { is_active: false });
      expect(mockSupabase.from).toHaveBeenCalledWith("users");
      expect(mockSupabase.from).toHaveBeenCalledWith("organization_users");
    });
  });

  describe("deactivateOrgMember / reactivateOrgMember", () => {
    it("deactivate appelle update({ is_active: false }) sur les deux tables", async () => {
      const chain = makeChain();
      mockSupabase.from.mockReturnValue(chain);

      await deactivateOrgMember(ORG_ID, USER_ID, MEMBERSHIP_ID);
      expect(chain.update).toHaveBeenCalledWith({ is_active: false });
    });

    it("reactivate appelle update({ is_active: true }) sur les deux tables", async () => {
      const chain = makeChain();
      mockSupabase.from.mockReturnValue(chain);

      await reactivateOrgMember(ORG_ID, USER_ID, MEMBERSHIP_ID);
      expect(chain.update).toHaveBeenCalledWith({ is_active: true });
    });
  });
});
