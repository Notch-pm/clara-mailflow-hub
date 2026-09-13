/**
 * Seuils d'écran partagés, en media queries.
 *
 * `PHONE_QUERY` est le complément EXACT de `md:` (= `min-width: 768px`), et non
 * `max-width: 767px` : à 767,5 px — zoom du navigateur, mise à l'échelle
 * Windows — aucune des deux bornes entières ne répond, et l'on servirait un
 * gabarit large sous un CSS déjà passé en étroit.
 *
 * À lire avec `useMediaQuery` (`src/hooks/useMediaQuery.ts`), dont la première
 * valeur est synchrone, et non `useIsMobile`, qui répond « non » au premier
 * rendu.
 */
export const PHONE_QUERY = "(max-width: 767.98px)";
