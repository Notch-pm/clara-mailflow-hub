import { describe, expect, it } from "vitest";
import { eventAnchor, eventCourierIdOf } from "@/lib/courier-events";

describe("eventCourierIdOf / eventAnchor", () => {
  it("une réponse journalise sur le courrier reçu auquel elle répond", () => {
    expect(eventCourierIdOf({ id: "r1", parent_courier_id: "p1" })).toBe("p1");
    expect(eventAnchor("p1", "r1")).toBe("p1");
  });

  it("un sortant sans parent journalise sur lui-même, jamais sur null", () => {
    // `logEvent(org, null, …)` échouait sans bruit : la signature d'un tel
    // courrier depuis l'espace élu ne laissait aucune trace.
    expect(eventCourierIdOf({ id: "s1", parent_courier_id: null })).toBe("s1");
    expect(eventCourierIdOf({ id: "s1" })).toBe("s1");
    expect(eventAnchor(null, "s1")).toBe("s1");
    expect(eventAnchor(undefined, "s1")).toBe("s1");
  });
});
