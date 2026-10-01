import { describe, expect, it } from "vitest";
import { serviceSuggestionKind } from "@/lib/service-suggestion";

const base = {
  isInitialState: true,
  assignableIds: ["ccas", "tech"],
  transferableIds: ["ccas", "tech", "urba"],
};

describe("serviceSuggestionKind", () => {
  it("sans proposition : rien", () => {
    expect(serviceSuggestionKind({ ...base, suggestedId: null, currentId: null })).toBe("none");
  });

  it("aucune organisation : affecter", () => {
    expect(serviceSuggestionKind({ ...base, suggestedId: "ccas", currentId: null })).toBe("assign");
  });

  it("même organisation : l'analyse confirme", () => {
    expect(serviceSuggestionKind({ ...base, suggestedId: "ccas", currentId: "ccas", isInitialState: false })).toBe(
      "confirm",
    );
  });

  it("autre organisation, état initial : réaffecter sans confirmation", () => {
    expect(serviceSuggestionKind({ ...base, suggestedId: "tech", currentId: "ccas" })).toBe("reassign");
  });

  it("autre organisation, courrier en cours : transférer (avec confirmation)", () => {
    expect(serviceSuggestionKind({ ...base, suggestedId: "urba", currentId: "ccas", isInitialState: false })).toBe(
      "transfer",
    );
  });

  it("hors de ce que l'agent peut choisir : indisponible, jamais un bouton", () => {
    expect(serviceSuggestionKind({ ...base, suggestedId: "urba", currentId: null })).toBe("unavailable");
    expect(
      serviceSuggestionKind({ ...base, suggestedId: "obsolete", currentId: "ccas", isInitialState: false }),
    ).toBe("unavailable");
  });
});
