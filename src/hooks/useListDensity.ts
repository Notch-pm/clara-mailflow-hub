import { createContext, useCallback, useContext, useMemo, useState } from "react";

/**
 * Densité d'affichage des listes : lignes de 48 px (deux niveaux de lecture)
 * ou de 36 px (une seule ligne, la ligne de contexte disparaît).
 */
export type ListDensity = "comfortable" | "compact";

/** Un seul réglage pour toutes les listes : c'est une préférence de lecture, pas de page. */
const STORAGE_KEY = "clara.list-density";

function readDensity(): ListDensity {
  // localStorage peut lever (navigation privée stricte, données bloquées) :
  // on retombe alors sur l'affichage par défaut.
  try {
    return localStorage.getItem(STORAGE_KEY) === "compact" ? "compact" : "comfortable";
  } catch {
    return "comfortable";
  }
}

export interface ListDensityValue {
  density: ListDensity;
  setDensity: (density: ListDensity) => void;
}

/** Fourni par `ListPage` ; lu par le tableau, les lignes et le bouton de densité. */
export const ListDensityContext = createContext<ListDensityValue | null>(null);

/** État persistant de la densité, à monter une fois par page de liste. */
export function usePersistedListDensity(): ListDensityValue {
  const [density, setState] = useState<ListDensity>(readDensity);
  const setDensity = useCallback((next: ListDensity) => {
    setState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Préférence non retenue, sans conséquence pour la session en cours.
    }
  }, []);
  // Valeur de contexte : un objet neuf à chaque rendu redessinerait toutes les lignes.
  return useMemo(() => ({ density, setDensity }), [density, setDensity]);
}

const FALLBACK: ListDensityValue = { density: "comfortable", setDensity: () => {} };

/** Densité courante ; hors d'une `ListPage`, l'affichage confortable. */
export function useListDensity(): ListDensityValue {
  return useContext(ListDensityContext) ?? FALLBACK;
}
