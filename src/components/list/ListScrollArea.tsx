import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { useLocation, useNavigationType } from "react-router-dom";
import { cn } from "@/lib/utils";

/**
 * Position laissée dans chaque liste, pour le retour arrière.
 *
 * Sur une page de liste, ce n'est plus `main` qui défile mais cette zone :
 * le mécanisme équivalent d'`AppLayout` n'y a donc plus prise. Clé = chemin,
 * une seule liste défilante par écran.
 */
const offsets = new Map<string, number>();

interface ListScrollAreaProps {
  children: ReactNode;
  className?: string;
  /**
   * Toute nouvelle valeur ramène la zone en haut — typiquement la page et la
   * taille de page. Sans cela, passer à la page suivante laisse la position
   * au bas de la précédente.
   */
  resetKey?: string | number;
}

/**
 * Seule zone qui défile sur une page de liste : l'en-tête de tableau y reste
 * collé, barre d'outils et pagination restent en place hors d'elle. C'est ce
 * qui supprime le double défilement (page ET tableau).
 */
export function ListScrollArea({ children, className, resetKey }: ListScrollAreaProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  const navigationType = useNavigationType();

  // Retenue AU FIL DU DÉFILEMENT : au moment de quitter l'écran, la zone est
  // déjà démontée (même raison que dans `AppLayout`).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const remember = () => offsets.set(pathname, el.scrollTop);
    el.addEventListener("scroll", remember, { passive: true });
    return () => el.removeEventListener("scroll", remember);
  }, [pathname]);

  // Un retour arrière rend la liste là où on l'avait laissée ; une navigation
  // avant commence en haut. Les lignes arrivent souvent APRÈS ce rendu (cache
  // froid) : on repasse une fois leur hauteur connue.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || navigationType !== "POP") return;
    const target = offsets.get(pathname) ?? 0;
    if (!target) return;
    el.scrollTop = target;
    const id = window.setTimeout(() => {
      el.scrollTop = Math.min(target, el.scrollHeight - el.clientHeight);
    }, 300);
    return () => window.clearTimeout(id);
    // Au montage seulement : c'est l'arrivée sur l'écran qui compte.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isFirstKey = useRef(true);
  useEffect(() => {
    if (isFirstKey.current) {
      isFirstKey.current = false;
      return;
    }
    ref.current?.scrollTo({ top: 0 });
  }, [resetKey]);

  return (
    <div ref={ref} className={cn("min-h-0 flex-1 overflow-auto", className)}>
      {children}
    </div>
  );
}
