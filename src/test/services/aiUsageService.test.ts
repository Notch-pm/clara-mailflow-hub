import { describe, it, expect, beforeEach, vi } from "vitest";
import "../mocks/supabase";
import { mockSupabase } from "../mocks/supabase";

// Import after mock is registered
const { getAiUsageSummary, upsertAiUsageQuota } = await import("@/services/aiUsageService");

const ORG_ID = "org-1";

beforeEach(() => {
  vi.clearAllMocks();
});

/** Builder chaînable (select/eq tous chaînables) qui se résout en `resolved` une fois "then" appelé (await). */
function chainable(resolved: { data: unknown[] | null; error: Error | null }) {
  const builder: Record<string, unknown> = {};
  const methods = ["select", "eq", "upsert"];
  for (const m of methods) {
    builder[m] = vi.fn(() => builder);
  }
  builder.then = vi.fn((resolve: (v: unknown) => unknown) => Promise.resolve(resolved).then(resolve));
  return builder;
}

describe("aiUsageService", () => {
  describe("getAiUsageSummary", () => {
    it("fusionne quota et compteur quand les deux existent", async () => {
      mockSupabase.from
        .mockReturnValueOnce(
          chainable({ data: [{ provider: null, monthly_limit_tokens: 100000, is_active: true }], error: null }),
        )
        .mockReturnValueOnce(
          chainable({ data: [{ provider: null, used_tokens: 4200, reserved_tokens: 300 }], error: null }),
        );

      const result = await getAiUsageSummary(ORG_ID);

      expect(result).toEqual([
        {
          provider: null,
          period: expect.any(String),
          monthlyLimitTokens: 100000,
          usedTokens: 4200,
          reservedTokens: 300,
          isActive: true,
        },
      ]);
    });

    it("retourne usedTokens/reservedTokens à 0 si aucun compteur n'existe encore pour la période", async () => {
      mockSupabase.from
        .mockReturnValueOnce(
          chainable({ data: [{ provider: "mistral", monthly_limit_tokens: 50000, is_active: true }], error: null }),
        )
        .mockReturnValueOnce(chainable({ data: [], error: null }));

      const result = await getAiUsageSummary(ORG_ID);

      expect(result).toHaveLength(1);
      expect(result[0].usedTokens).toBe(0);
      expect(result[0].reservedTokens).toBe(0);
    });

    it("retourne un tableau vide si aucun quota n'est configuré (organisation illimitée)", async () => {
      mockSupabase.from.mockReturnValue(chainable({ data: [], error: null }));

      const result = await getAiUsageSummary(ORG_ID);

      expect(result).toEqual([]);
    });

    it("gère plusieurs quotas par fournisseur indépendamment", async () => {
      mockSupabase.from
        .mockReturnValueOnce(
          chainable({
            data: [
              { provider: "mistral", monthly_limit_tokens: 50000, is_active: true },
              { provider: "openai", monthly_limit_tokens: 20000, is_active: false },
            ],
            error: null,
          }),
        )
        .mockReturnValueOnce(
          chainable({ data: [{ provider: "mistral", used_tokens: 1000, reserved_tokens: 0 }], error: null }),
        );

      const result = await getAiUsageSummary(ORG_ID);

      expect(result).toHaveLength(2);
      const mistral = result.find((r) => r.provider === "mistral");
      const openai = result.find((r) => r.provider === "openai");
      expect(mistral?.usedTokens).toBe(1000);
      expect(openai?.usedTokens).toBe(0);
      expect(openai?.isActive).toBe(false);
    });

    it("propage l'erreur Supabase sur les quotas", async () => {
      mockSupabase.from.mockReturnValue(chainable({ data: null, error: new Error("DB error") }));
      await expect(getAiUsageSummary(ORG_ID)).rejects.toThrow("DB error");
    });
  });

  describe("upsertAiUsageQuota", () => {
    it("appelle upsert avec onConflict organization_id,provider", async () => {
      const upsertFn = vi.fn().mockResolvedValue({ data: null, error: null });
      mockSupabase.from.mockReturnValue({ upsert: upsertFn });

      await upsertAiUsageQuota(ORG_ID, null, 100000);

      expect(mockSupabase.from).toHaveBeenCalledWith("ai_usage_quotas");
      expect(upsertFn).toHaveBeenCalledWith(
        { organization_id: ORG_ID, provider: "__global__", monthly_limit_tokens: 100000, is_active: true },
        { onConflict: "organization_id,provider" },
      );
    });

    it("propage l'erreur Supabase", async () => {
      mockSupabase.from.mockReturnValue({ upsert: vi.fn().mockResolvedValue({ data: null, error: new Error("RLS denied") }) });
      await expect(upsertAiUsageQuota(ORG_ID, "mistral", 1000)).rejects.toThrow("RLS denied");
    });
  });
});
