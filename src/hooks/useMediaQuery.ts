import { useEffect, useState } from "react";

/**
 * Suit une media query CSS. La valeur initiale est lue de façon synchrone,
 * contrairement à `useIsMobile` : le premier rendu est déjà le bon, sans passer
 * par un état intermédiaire. C'est ce qu'il faut quand la requête choisit un
 * gabarit — un faux « non » au premier rendu ferait clignoter la page.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== "undefined" && !!window.matchMedia?.(query).matches,
  );

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    // Relit à l'abonnement : la largeur a pu changer entre le rendu et l'effet.
    setMatches(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}
