import { isElu } from "@/lib/permissions";

/**
 * Espace élu mobile : la décision « quel gabarit sert-on ? », isolée du React
 * pour être testable sans DOM ni routeur.
 *
 * Trois conditions, toutes nécessaires : l'utilisateur est élu OU viseur,
 * l'écran est un téléphone, et il n'a pas demandé l'affichage complet.
 *
 * Le viseur (attribut `is_viseur`, indépendant du rôle — chef de service, DGS)
 * y est servi depuis le 2026-10-01 : sur téléphone, son premier besoin est de
 * viser, comme celui de l'élu est de signer. Il garde la bascule vers
 * l'application complète, pour instruire.
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
  membership: { role?: string | null; is_viseur?: boolean | null } | null | undefined;
  isPhone: boolean;
  choice: EluDisplayChoice;
}

export interface EluModeResolution {
  isElu: boolean;
  isViseur: boolean;
  /** Élu ou viseur : l'espace mobile lui est destiné. */
  eligible: boolean;
  isPhone: boolean;
  optedOut: boolean;
  active: boolean;
}

export function resolveEluMode({ membership, isPhone, choice }: EluModeInput): EluModeResolution {
  const elu = isElu(membership);
  const viseur = membership?.is_viseur === true;
  const eligible = elu || viseur;
  const optedOut = choice === "complet";
  return { isElu: elu, isViseur: viseur, eligible, isPhone, optedOut, active: eligible && isPhone && !optedOut };
}
