import { describe, it, expect, beforeEach, vi } from "vitest";
import "../mocks/supabase";
import { mockSupabase } from "../mocks/supabase";

// Import after mock is registered
const { findMatchingUsager, listUsagers, fetchAllUsagersForExport } =
  await import("@/services/usagerService");

const ORG_ID = "org-1";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("usagerService", () => {
  describe("findMatchingUsager", () => {
    it("retourne null si ni email ni téléphone fourni", async () => {
      const result = await findMatchingUsager(ORG_ID, {});
      expect(result).toBeNull();
    });

    it("retourne l'usager si trouvé par email", async () => {
      const fakeUsager = { id: "u-1", email: "test@example.com", last_name: "Dupont" };
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        ilike: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: fakeUsager, error: null }),
      });

      const result = await findMatchingUsager(ORG_ID, { email: "test@example.com" });
      expect(result).toEqual(fakeUsager);
    });

    it("normalise l'email en minuscules avant la recherche", async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        ilike: vi.fn((col: string, val: string) => {
          expect(val).toBe("test@example.com");
          return { limit: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) };
        }),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      });

      await findMatchingUsager(ORG_ID, { email: "TEST@EXAMPLE.COM" });
    });

    it("retourne null si aucun usager trouvé", async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        ilike: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      });

      const result = await findMatchingUsager(ORG_ID, { email: "inconnu@example.com" });
      expect(result).toBeNull();
    });
  });

  describe("listUsagers", () => {
    it("appelle supabase.from avec la table usagers", async () => {
      const fakeFrom = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [], error: null }),
      };
      mockSupabase.from.mockReturnValue(fakeFrom);

      await listUsagers(ORG_ID);
      expect(mockSupabase.from).toHaveBeenCalledWith("usagers");
    });

    it("retourne un tableau vide si aucune donnée", async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: null, error: null }),
      });

      const result = await listUsagers(ORG_ID);
      expect(result).toEqual([]);
    });

    it("propage l'erreur Supabase", async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: null, error: new Error("DB error") }),
      });

      await expect(listUsagers(ORG_ID)).rejects.toThrow("DB error");
    });
  });

  describe("fetchAllUsagersForExport", () => {
    it("retourne toutes les lignes en une seule page si moins de 500 résultats", async () => {
      const fakeRows = Array.from({ length: 10 }, (_, i) => ({ id: `u-${i}` }));
      mockSupabase.rpc.mockResolvedValue({ data: fakeRows, error: null });

      const result = await fetchAllUsagersForExport(ORG_ID, { search: "dup" });

      expect(result).toHaveLength(10);
      expect(mockSupabase.rpc).toHaveBeenCalledTimes(1);
      expect(mockSupabase.rpc).toHaveBeenCalledWith(
        "search_usagers",
        expect.objectContaining({ p_org_id: ORG_ID, p_search: "dup", p_limit: 500, p_offset: 0 }),
      );
    });

    it("pagine par blocs de 500 jusqu'à une page incomplète", async () => {
      const fullPage = Array.from({ length: 500 }, (_, i) => ({ id: `u-${i}` }));
      const lastPage = Array.from({ length: 3 }, (_, i) => ({ id: `v-${i}` }));
      mockSupabase.rpc
        .mockResolvedValueOnce({ data: fullPage, error: null })
        .mockResolvedValueOnce({ data: lastPage, error: null });

      const result = await fetchAllUsagersForExport(ORG_ID);

      expect(result).toHaveLength(503);
      expect(mockSupabase.rpc).toHaveBeenCalledTimes(2);
      expect(mockSupabase.rpc).toHaveBeenNthCalledWith(1, "search_usagers", expect.objectContaining({ p_offset: 0 }));
      expect(mockSupabase.rpc).toHaveBeenNthCalledWith(
        2,
        "search_usagers",
        expect.objectContaining({ p_offset: 500 }),
      );
    });

    it("propage l'erreur Supabase", async () => {
      mockSupabase.rpc.mockResolvedValue({ data: null, error: new Error("RPC error") });
      await expect(fetchAllUsagersForExport(ORG_ID)).rejects.toThrow("RPC error");
    });
  });
});
