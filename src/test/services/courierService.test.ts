import { describe, it, expect, beforeEach, vi } from "vitest";
import "../mocks/supabase";
import { mockSupabase } from "../mocks/supabase";

// Import after mock is registered
const { fetchAllCouriersForExport, fetchAllCouriersByStatesForExport } =
  await import("@/services/courierService");

const ORG_ID = "org-1";

beforeEach(() => {
  vi.clearAllMocks();
});

/** Builder chaînable (select/eq/order/ilike/in/range tous chaînables) qui se résout en `resolved` une fois "then" appelé (await). */
function chainable(resolved: { data: unknown[] | null; error: Error | null }) {
  const builder: Record<string, unknown> = {};
  const methods = ["select", "eq", "order", "ilike", "in", "range"];
  for (const m of methods) {
    builder[m] = vi.fn(() => builder);
  }
  builder.then = vi.fn((resolve: (v: unknown) => unknown) => Promise.resolve(resolved).then(resolve));
  return builder;
}

describe("courierService", () => {
  describe("fetchAllCouriersForExport", () => {
    it("retourne toutes les lignes en une seule page si moins de 500 résultats", async () => {
      const rows = Array.from({ length: 10 }, (_, i) => ({ id: `c-${i}` }));
      mockSupabase.from.mockReturnValue(chainable({ data: rows, error: null }));

      const result = await fetchAllCouriersForExport(ORG_ID, { direction: "inbound" });

      expect(result).toHaveLength(10);
      expect(mockSupabase.from).toHaveBeenCalledWith("couriers");
    });

    it("pagine par blocs de 500 jusqu'à une page incomplète", async () => {
      const fullPage = Array.from({ length: 500 }, (_, i) => ({ id: `c-${i}` }));
      const lastPage = Array.from({ length: 7 }, (_, i) => ({ id: `d-${i}` }));
      mockSupabase.from
        .mockReturnValueOnce(chainable({ data: fullPage, error: null }))
        .mockReturnValueOnce(chainable({ data: lastPage, error: null }));

      const result = await fetchAllCouriersForExport(ORG_ID, { direction: "outbound" });

      expect(result).toHaveLength(507);
      expect(mockSupabase.from).toHaveBeenCalledTimes(2);
    });

    it("propage l'erreur Supabase", async () => {
      mockSupabase.from.mockReturnValue(chainable({ data: null, error: new Error("DB error") }));
      await expect(fetchAllCouriersForExport(ORG_ID, { direction: "inbound" })).rejects.toThrow("DB error");
    });
  });

  describe("fetchAllCouriersByStatesForExport", () => {
    it("retourne un tableau vide sans requête si stateIds est vide", async () => {
      const result = await fetchAllCouriersByStatesForExport(ORG_ID, { stateIds: [] });
      expect(result).toEqual([]);
      expect(mockSupabase.from).not.toHaveBeenCalled();
    });

    it("retourne toutes les lignes en une seule page si moins de 500 résultats", async () => {
      const rows = Array.from({ length: 3 }, (_, i) => ({ id: `c-${i}` }));
      mockSupabase.from.mockReturnValue(chainable({ data: rows, error: null }));

      const result = await fetchAllCouriersByStatesForExport(ORG_ID, { stateIds: ["state-1"] });

      expect(result).toHaveLength(3);
    });

    it("propage l'erreur Supabase", async () => {
      mockSupabase.from.mockReturnValue(chainable({ data: null, error: new Error("RPC error") }));
      await expect(
        fetchAllCouriersByStatesForExport(ORG_ID, { stateIds: ["state-1"] }),
      ).rejects.toThrow("RPC error");
    });
  });
});
