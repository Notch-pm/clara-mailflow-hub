import { describe, it, expect, beforeEach, vi } from "vitest";
import "../mocks/supabase";
import { mockSupabase } from "../mocks/supabase";

// Import after mock is registered
const { getAiUsageSummary, quotaView, renewalLabel, formatTokens } = await import(
  "@/services/aiUsageService"
);

const ORG_ID = "3f6a2c10-0000-4000-8000-000000000001";

beforeEach(() => {
  vi.clearAllMocks();
});

/** Réponse type de l'edge function `socle-ai-usage` (déjà sanitisée par elle). */
function usageResponse(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      usage: {
        period: "2026-08",
        renews_at: "2026-09-01",
        limit: 1_000_000,
        used_tokens: 420_000,
        reserved_tokens: 30_000,
        by_consumer: [
          { consumer: "clara", feature: "analyse-courrier", calls: 12, tokens: 300_000 },
          { consumer: "iris", feature: null, calls: 4, tokens: 150_000 },
        ],
        ...overrides,
      },
    },
    error: null,
  };
}

describe("getAiUsageSummary", () => {
  // ⚠️ LE POINT LE PLUS IMPORTANT DE CE FICHIER : depuis la centralisation du
  // 2026-08-29, ce service ne lit AUCUNE table. Les tables `ai_usage_*` de
  // Clara ont été supprimées ; les relire rouvrirait un second compteur, qui
  // afficherait zéro pendant que la collectivité dépense son mois ailleurs.
  it("passe par l'edge function, jamais par une table", async () => {
    mockSupabase.functions.invoke.mockResolvedValueOnce(usageResponse());

    await getAiUsageSummary(ORG_ID);

    expect(mockSupabase.functions.invoke).toHaveBeenCalledWith("socle-ai-usage", {
      body: { organization_id: ORG_ID },
    });
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });

  it("rend la consommation et la ventilation par application", async () => {
    mockSupabase.functions.invoke.mockResolvedValueOnce(usageResponse());

    const summary = await getAiUsageSummary(ORG_ID);

    expect(summary).toEqual({
      period: "2026-08",
      renewsAt: "2026-09-01",
      limitTokens: 1_000_000,
      usedTokens: 420_000,
      reservedTokens: 30_000,
      byConsumer: [
        { consumer: "clara", feature: "analyse-courrier", calls: 12, tokens: 300_000 },
        { consumer: "iris", feature: null, calls: 4, tokens: 150_000 },
      ],
    });
  });

  it("transmet la période demandée quand elle est fournie", async () => {
    mockSupabase.functions.invoke.mockResolvedValueOnce(usageResponse({ period: "2026-07" }));

    await getAiUsageSummary(ORG_ID, "2026-07");

    expect(mockSupabase.functions.invoke).toHaveBeenCalledWith("socle-ai-usage", {
      body: { organization_id: ORG_ID, period: "2026-07" },
    });
  });

  it("une réponse vide ou inattendue ne casse pas l'écran", async () => {
    mockSupabase.functions.invoke.mockResolvedValueOnce({ data: null, error: null });

    const summary = await getAiUsageSummary(ORG_ID);

    expect(summary.limitTokens).toBe(null);
    expect(summary.usedTokens).toBe(0);
    expect(summary.byConsumer).toEqual([]);
  });

  it("relaie l'erreur de l'edge function", async () => {
    mockSupabase.functions.invoke.mockResolvedValueOnce({
      data: null,
      error: new Error("socle_unreachable"),
    });

    await expect(getAiUsageSummary(ORG_ID)).rejects.toThrow("socle_unreachable");
  });
});

describe("quotaView", () => {
  const base = {
    period: "2026-08",
    renewsAt: "2026-09-01",
    usedTokens: 0,
    reservedTokens: 0,
    byConsumer: [],
  };

  it("aucun plafond ⇒ illimité", () => {
    const view = quotaView({ ...base, limitTokens: null });
    expect(view.unlimited).toBe(true);
    expect(view.remainingTokens).toBe(null);
    expect(view.percent).toBe(0);
  });

  it("un plafond nul ou négatif vaut aucun plafond", () => {
    expect(quotaView({ ...base, limitTokens: 0 }).unlimited).toBe(true);
    expect(quotaView({ ...base, limitTokens: -5 }).unlimited).toBe(true);
  });

  // ⚠️ Un appel en cours a DÉJÀ mordu sur le plafond : l'ignorer ferait
  // annoncer un reliquat qui n'existe pas.
  it("le réservé compte dans l'engagé", () => {
    const view = quotaView({ ...base, limitTokens: 1000, usedTokens: 400, reservedTokens: 100 });
    expect(view.engagedTokens).toBe(500);
    expect(view.remainingTokens).toBe(500);
    expect(view.percent).toBe(50);
  });

  // ⚠️ LE TON SE DÉCIDE SUR LE RATIO, JAMAIS SUR `percent` : 79,9 % s'arrondit
  // à 80 et déclencherait une alerte que l'engagé réel ne justifie pas.
  it("799/1000 reste calme malgré un affichage à 80 %", () => {
    const view = quotaView({ ...base, limitTokens: 1000, usedTokens: 799 });
    expect(view.percent).toBe(80);
    expect(view.tone).toBe("ok");
  });

  it("800/1000 avertit", () => {
    expect(quotaView({ ...base, limitTokens: 1000, usedTokens: 800 }).tone).toBe("warn");
  });

  // ⚠️ Un dépassement ramené à 100 % serait lu comme un simple avertissement.
  it("un dépassement est critique, et la jauge ne déborde pas", () => {
    const view = quotaView({ ...base, limitTokens: 1000, usedTokens: 1500 });
    expect(view.tone).toBe("critical");
    expect(view.percent).toBe(100);
    expect(view.remainingTokens).toBe(0);
  });
});

describe("renewalLabel", () => {
  // ⚠️ La date vient du SOCLE et n'est jamais recalculée ici : Clara ne fait
  // que la mettre en français. Deux calculs de période qui dérivent ne cassent
  // rien de visible — ils font simplement mentir le message.
  it("met en français une date du Socle", () => {
    expect(renewalLabel("2026-09-01")).toBe("1ᵉʳ septembre 2026");
    expect(renewalLabel("2027-01-01")).toBe("1ᵉʳ janvier 2027");
  });

  it("accepte une date ISO complète", () => {
    expect(renewalLabel("2026-09-01T00:00:00Z")).toBe("1ᵉʳ septembre 2026");
  });

  it("rien à afficher quand le Socle n'a rien dit", () => {
    expect(renewalLabel(null)).toBe("");
    expect(renewalLabel(undefined)).toBe("");
  });

  // Mieux vaut afficher ce que le serveur a dit qu'inventer un mois.
  it("rend telle quelle une entrée qui n'est pas une date", () => {
    expect(renewalLabel("bientôt")).toBe("bientôt");
  });
});

describe("formatTokens", () => {
  it("sépare les milliers par une espace fine insécable", () => {
    expect(formatTokens(1250000)).toBe("1 250 000");
    expect(formatTokens(999)).toBe("999");
  });

  it("jamais de négatif à l'écran", () => {
    expect(formatTokens(-10)).toBe("0");
  });
});
