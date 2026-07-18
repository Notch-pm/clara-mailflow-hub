import { describe, it, expect } from "vitest";
import { getPageWindow } from "@/components/data-table/data-table-pagination";

/** -1 représente une ellipse dans la fenêtre renvoyée. */
describe("getPageWindow", () => {
  it("liste toutes les pages en dessous du seuil, sans ellipse", () => {
    expect(getPageWindow(0, 1)).toEqual([0]);
    expect(getPageWindow(3, 7)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("garde la première et la dernière page toujours accessibles", () => {
    const window = getPageWindow(20, 42);
    expect(window[0]).toBe(0);
    expect(window[window.length - 1]).toBe(41);
  });

  it("encadre la page courante et insère des ellipses", () => {
    expect(getPageWindow(20, 42)).toEqual([0, -1, 19, 20, 21, -1, 41]);
  });

  it("ne place pas d'ellipse là où il ne manque aucune page", () => {
    // Entre 0 et 1 il n'y a pas de trou : une ellipse masquerait une seule page.
    const window = getPageWindow(1, 20);
    expect(window).toEqual([0, 1, 2, 3, -1, 19]);
  });

  it("reste stable en début et en fin de liste", () => {
    expect(getPageWindow(0, 20)).toEqual([0, 1, 2, 3, -1, 19]);
    expect(getPageWindow(19, 20)).toEqual([0, -1, 16, 17, 18, 19]);
  });

  it("n'émet jamais de page hors bornes", () => {
    for (const pageCount of [1, 2, 8, 20, 137]) {
      const candidates = [0, 1, Math.floor(pageCount / 2), pageCount - 1];
      for (const page of candidates.filter((p) => p < pageCount)) {
        const window = getPageWindow(page, pageCount);
        for (const p of window) {
          if (p === -1) continue;
          expect(p).toBeGreaterThanOrEqual(0);
          expect(p).toBeLessThan(pageCount);
        }
        // La page courante doit toujours être atteignable.
        expect(window).toContain(page);
      }
    }
  });

  it("borne une page hors intervalle au lieu de la propager", () => {
    // Cas réel : un rendu s'intercale entre l'arrivée des données et le recalage
    // de page fait par useCourierList.
    expect(getPageWindow(5, 1)).toEqual([0]);
    expect(getPageWindow(-3, 4)).toEqual([0, 1, 2, 3]);
    expect(getPageWindow(0, 0)).toEqual([]);
  });

  it("ne répète jamais une page", () => {
    const window = getPageWindow(5, 30);
    const pages = window.filter((p) => p !== -1);
    expect(new Set(pages).size).toBe(pages.length);
  });
});
