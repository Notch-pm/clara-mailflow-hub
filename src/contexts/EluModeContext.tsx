import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import {
  ELU_MOBILE_QUERY,
  eluDisplayStorageKey,
  parseEluDisplayChoice,
  resolveEluMode,
  type EluDisplayChoice,
} from "@/lib/elu-mode";

export interface EluModeValue {
  /** Le rôle d'organisation est `elu`. */
  isElu: boolean;
  /** L'utilisateur porte l'attribut viseur. */
  isViseur: boolean;
  /** Élu ou viseur : l'espace mobile lui est destiné. */
  eligible: boolean;
  /** L'écran est un téléphone (sous le seuil `md`). */
  isPhone: boolean;
  /** L'élu a demandé l'affichage complet sur CET appareil. */
  optedOut: boolean;
  /** Les trois conditions sont réunies : on sert l'espace élu. */
  active: boolean;
  setOptedOut: (value: boolean) => void;
}

const EluModeContext = createContext<EluModeValue | null>(null);

/** Hors provider : jamais actif. Un composant partagé peut ainsi l'interroger sans garde. */
const FALLBACK: EluModeValue = {
  isElu: false,
  isViseur: false,
  eligible: false,
  isPhone: false,
  optedOut: false,
  active: false,
  setOptedOut: () => {},
};

function readChoice(userId: string | null): EluDisplayChoice {
  if (!userId) return "simplifie";
  // localStorage peut lever (navigation privée stricte, données bloquées) :
  // on retombe alors sur l'affichage simplifié, celui que le rôle appelle.
  try {
    return parseEluDisplayChoice(localStorage.getItem(eluDisplayStorageKey(userId)));
  } catch {
    return "simplifie";
  }
}

export function EluModeProvider({ children }: { children: ReactNode }) {
  const { user, membership } = useAuth();
  const userId = user?.id ?? null;
  // `useMediaQuery` lit la largeur de façon SYNCHRONE au premier rendu,
  // contrairement à `useIsMobile` : sans cela le tableau de bord complet
  // s'afficherait un instant avant de céder la place à l'espace élu.
  const isPhone = useMediaQuery(ELU_MOBILE_QUERY);
  const [choice, setChoice] = useState<EluDisplayChoice>(() => readChoice(userId));

  // Téléphone de service : si l'utilisateur change sans que le provider soit
  // démonté, le choix du précédent ne doit pas rester en place.
  const [readFor, setReadFor] = useState(userId);
  if (readFor !== userId) {
    setReadFor(userId);
    setChoice(readChoice(userId));
  }

  const setOptedOut = useCallback(
    (value: boolean) => {
      const next: EluDisplayChoice = value ? "complet" : "simplifie";
      setChoice(next);
      if (!userId) return;
      try {
        localStorage.setItem(eluDisplayStorageKey(userId), next);
      } catch {
        // Préférence non retenue au prochain lancement, sans conséquence ici.
      }
    },
    [userId],
  );

  const value = useMemo<EluModeValue>(
    () => ({ ...resolveEluMode({ membership, isPhone, choice }), setOptedOut }),
    [membership, isPhone, choice, setOptedOut],
  );

  return <EluModeContext.Provider value={value}>{children}</EluModeContext.Provider>;
}

export function useEluMode(): EluModeValue {
  return useContext(EluModeContext) ?? FALLBACK;
}
