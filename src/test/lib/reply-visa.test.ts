import { describe, expect, it } from "vitest";
import { isFreeExitFromVisa } from "@/lib/reply-visa";

/**
 * Miroir écran du trigger `couriers_enforce_visa` : ce qui sort d'une étape de
 * visa sans visa. Si les deux divergent, le téléphone propose un bouton que la
 * base refuse — ou cache un retour pourtant permis.
 */
const choice = (
  kind: "next" | "previous" | null,
  target: { is_initial?: boolean; is_final?: boolean; category?: string | null } = {},
) => ({
  kind,
  target: {
    is_initial: target.is_initial ?? false,
    is_final: target.is_final ?? false,
    category: target.category ?? "processing",
  },
});

describe("isFreeExitFromVisa", () => {
  it("laisse passer le retour en arrière", () => {
    expect(isFreeExitFromVisa(choice("previous"))).toBe(true);
  });

  it("laisse passer le renvoi à l'état initial, quel que soit le libellé", () => {
    expect(isFreeExitFromVisa(choice(null, { is_initial: true }))).toBe(true);
  });

  it("laisse passer l'abandon (état final hors « traité »)", () => {
    expect(isFreeExitFromVisa(choice(null, { is_final: true, category: "archived" }))).toBe(true);
  });

  it("refuse l'avance nominale", () => {
    expect(isFreeExitFromVisa(choice("next"))).toBe(false);
  });

  it("refuse une transition secondaire vers l'avant", () => {
    expect(isFreeExitFromVisa(choice(null, { category: "processing" }))).toBe(false);
  });

  it("refuse l'envoi : un état final « traité » exige le visa", () => {
    expect(isFreeExitFromVisa(choice(null, { is_final: true, category: "processed" }))).toBe(false);
  });
});
