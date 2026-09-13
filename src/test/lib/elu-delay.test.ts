import { describe, expect, it } from "vitest";
import { oldestWaitingLabel, waitingDays, waitingLabel } from "@/lib/elu-delay";

describe("waitingDays", () => {
  const now = new Date(2026, 8, 13, 9, 0); // dimanche 13 septembre 2026, 9 h

  it("compte des jours de calendrier, pas des tranches de 24 h", () => {
    // Le piège : 23 h 55 la veille fait moins de 24 h, mais c'est bien « 1 jour ».
    expect(waitingDays(new Date(2026, 8, 12, 23, 55), now)).toBe(1);
    expect(waitingDays(new Date(2026, 8, 13, 0, 5), now)).toBe(0);
    expect(waitingDays(new Date(2026, 8, 10, 18, 0), now)).toBe(3);
  });

  it("ne descend jamais sous zéro, même sur une date à venir", () => {
    expect(waitingDays(new Date(2026, 8, 20), now)).toBe(0);
  });

  it("absente ou illisible → zéro, jamais NaN", () => {
    expect(waitingDays(null, now)).toBe(0);
    expect(waitingDays(undefined, now)).toBe(0);
    expect(waitingDays("pas une date", now)).toBe(0);
  });

  it("accepte une chaîne ISO, comme celles de la base", () => {
    expect(waitingDays(new Date(2026, 8, 11, 12, 0).toISOString(), now)).toBe(2);
  });
});

describe("waitingLabel", () => {
  it("accorde le pluriel et nomme le cas du jour même", () => {
    expect(waitingLabel(0)).toBe("Arrivé aujourd'hui");
    expect(waitingLabel(1)).toBe("En attente depuis 1 jour");
    expect(waitingLabel(3)).toBe("En attente depuis 3 jours");
    expect(waitingLabel(30)).toBe("En attente depuis 30 jours");
  });
});

describe("oldestWaitingLabel", () => {
  it("accorde le pluriel", () => {
    expect(oldestWaitingLabel(0)).toBe("Tous arrivés aujourd'hui");
    expect(oldestWaitingLabel(1)).toBe("Le plus ancien attend depuis 1 jour");
    expect(oldestWaitingLabel(3)).toBe("Le plus ancien attend depuis 3 jours");
  });
});
