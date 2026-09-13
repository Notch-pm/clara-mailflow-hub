import { vi } from "vitest";

/**
 * `matchMedia` qui répond vraiment à la requête posée.
 *
 * Le stub global de `src/test/setup.ts` renvoie `matches: false` en dur et
 * n'émet jamais `change` : tout composant qui choisit son gabarit sur une media
 * query y est donc testé en desktop, et un test de l'espace élu passerait au
 * vert sans jamais monter l'espace élu.
 *
 * On ne corrige pas le stub global : y poser une largeur par défaut ferait
 * basculer `(min-width: 1024px)` de `false` à `true` et changerait le
 * comportement de tests existants (la boîte aux lettres et son `SPLIT_VIEW_QUERY`).
 * Les tests qui en ont besoin l'installent explicitement.
 *
 *     beforeEach(() => installMatchMedia(390));
 *     afterEach(restoreMatchMedia);
 */

type Listener = (event: MediaQueryListEvent) => void;

const original = Object.getOwnPropertyDescriptor(window, "matchMedia");
let currentWidth = 1280;
const registry = new Set<{ query: string; listeners: Set<Listener>; notify: () => void }>();

/** N'interprète que `min-width` / `max-width` : les seules requêtes du dépôt. */
function evaluate(query: string, width: number): boolean {
  const clauses = query.split(" and ");
  return clauses.every((clause) => {
    const min = /min-width:\s*([\d.]+)px/.exec(clause);
    if (min) return width >= Number.parseFloat(min[1]);
    const max = /max-width:\s*([\d.]+)px/.exec(clause);
    if (max) return width <= Number.parseFloat(max[1]);
    return true;
  });
}

export function installMatchMedia(width: number) {
  currentWidth = width;
  registry.clear();

  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn((query: string) => {
      const listeners = new Set<Listener>();
      const entry = {
        query,
        listeners,
        notify: () => {
          const event = { matches: evaluate(query, currentWidth), media: query } as MediaQueryListEvent;
          listeners.forEach((listener) => listener(event));
        },
      };
      registry.add(entry);

      return {
        get matches() {
          return evaluate(query, currentWidth);
        },
        media: query,
        onchange: null,
        addListener: (listener: Listener) => listeners.add(listener),
        removeListener: (listener: Listener) => listeners.delete(listener),
        addEventListener: (_: string, listener: Listener) => listeners.add(listener),
        removeEventListener: (_: string, listener: Listener) => listeners.delete(listener),
        dispatchEvent: () => true,
      };
    }),
  });
}

/** Change la largeur et prévient les abonnés, comme le ferait une rotation. */
export function resizeTo(width: number) {
  currentWidth = width;
  registry.forEach((entry) => entry.notify());
}

export function restoreMatchMedia() {
  registry.clear();
  if (original) Object.defineProperty(window, "matchMedia", original);
}
