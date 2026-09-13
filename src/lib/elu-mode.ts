import { isElu } from "@/lib/permissions";

/**
 * Espace élu mobile : la décision « quel gabarit sert-on ? », isolée du React
 * pour être testable sans DOM ni routeur.
 *
 * Trois conditions, toutes nécessaires : le rôle est `elu`, l'écran est un
 * téléphone, et l'élu n'a pas demandé l'affichage complet.
 */

/** Seuil téléphone : une seule définition pour toute l'application. */
export { PHONE_QUERY as ELU_MOBILE_QUERY } from "@/lib/breakpoints";

export type EluDisplayChoice = "simplifie" | "complet";

/**
 * La clé est scopée par utilisateur. `useListDensity` s'en passe, mais il s'agit
 * ici d'un téléphone de service que plusieurs élus peuvent partager : le choix
 * de l'un ne doit pas s'appliquer au suivant.
 */
export function eluDisplayStorageKey(userId: string): string {
  return `clara.elu-affichage:${userId}`;
}

export function parseEluDisplayChoice(raw: string | null | undefined): EluDisplayChoice {
  return raw === "complet" ? "complet" : "simplifie";
}

export interface EluModeInput {
  membership: { role?: string | null } | null | undefined;
  isPhone: boolean;
  choice: EluDisplayChoice;
}

export interface EluModeResolution {
  isElu: boolean;
  isPhone: boolean;
  optedOut: boolean;
  active: boolean;
}

export function resolveEluMode({ membership, isPhone, choice }: EluModeInput): EluModeResolution {
  const elu = isElu(membership);
  const optedOut = choice === "complet";
  return { isElu: elu, isPhone, optedOut, active: elu && isPhone && !optedOut };
}
