import { describe, expect, it } from "vitest";
import { daysUntilPurge, purgeLabel, TRASH_RETENTION_DAYS } from "@/lib/trash";
import { navItemVisible } from "@/lib/permissions";

const now = new Date("2026-10-01T12:00:00Z");
const inHours = (h: number) => new Date(now.getTime() + h * 3600_000).toISOString();

describe("daysUntilPurge", () => {
  it("arrondit au jour supérieur", () => {
    expect(daysUntilPurge(inHours(TRASH_RETENTION_DAYS * 24), now)).toBe(30);
    expect(daysUntilPurge(inHours(25), now)).toBe(2);
    expect(daysUntilPurge(inHours(1), now)).toBe(1);
  });

  it("jamais négatif, même échu ou invalide", () => {
    expect(daysUntilPurge(inHours(-5), now)).toBe(0);
    expect(daysUntilPurge("pas une date", now)).toBe(0);
  });
});

describe("purgeLabel", () => {
  it("dit l'échéance en clair", () => {
    expect(purgeLabel(0)).toBe("Cette nuit");
    expect(purgeLabel(1)).toBe("Demain");
    expect(purgeLabel(12)).toBe("Dans 12 jours");
  });
});

describe("navItemVisible('/corbeille')", () => {
  it("même public que Courrier entrant", () => {
    expect(navItemVisible("/corbeille", null, { role: "gestionnaire", is_service_courrier: true })).toBe(true);
    expect(navItemVisible("/corbeille", null, { role: "administrateur" })).toBe(true);
    expect(navItemVisible("/corbeille", { is_superadmin: true }, null)).toBe(true);
  });

  it("caché aux autres", () => {
    for (const role of ["gestionnaire", "elu", "superviseur", "consultant"]) {
      expect(navItemVisible("/corbeille", null, { role, is_service_courrier: false })).toBe(false);
    }
  });
});
