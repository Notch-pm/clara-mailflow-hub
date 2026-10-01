import { describe, expect, it } from "vitest";
import { isFreeExitFromVisa, nominalPathReaches } from "@/lib/reply-visa";

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

/**
 * Le workflow de Seine Normandie Agglomération (2026-10-01) : « Visa » a une
 * sortie secondaire « A corriger », dont la suite nominale « Pour visa » y
 * ramène. Signature a AUSSI une sortie secondaire vers « A corriger » — d'où
 * le chemin NOMINAL seul : sinon « Pour signature » passerait sans visa.
 */
describe("isFreeExitFromVisa — renvoi pour correction", () => {
  const T = (from: string, to: string, kind: string | null = null) => ({ from_state_id: from, to_state_id: to, kind });
  const transitions = [
    T("non-repondu", "visa", "next"),
    T("visa", "signature", "next"),
    T("visa", "a-corriger"),
    T("a-corriger", "visa", "next"),
    T("signature", "envoi", "next"),
    T("signature", "a-corriger"),
    T("envoi", "repondu", "next"),
  ];
  const graph = { visaStateId: "visa", transitions };
  const target = (id: string, extra: { is_final?: boolean; category?: string } = {}) => ({
    id,
    is_initial: false,
    is_final: extra.is_final ?? false,
    category: extra.category ?? "processing",
  });

  it("« A corriger » est libre : sa suite nominale ramène au visa", () => {
    expect(isFreeExitFromVisa({ kind: null, target: target("a-corriger") }, graph)).toBe(true);
  });

  it("« Pour signature » reste une avance, malgré le détour possible par « A corriger »", () => {
    expect(isFreeExitFromVisa({ kind: "next", target: target("signature") }, graph)).toBe(false);
  });

  it("sans le graphe, on reste prudent : refus", () => {
    expect(isFreeExitFromVisa({ kind: null, target: target("a-corriger") })).toBe(false);
  });

  it("un cycle de transitions nominales ne boucle pas", () => {
    const cyc = [T("a", "b", "next"), T("b", "a", "next")];
    expect(nominalPathReaches("a", "visa", cyc)).toBe(false);
  });
});
