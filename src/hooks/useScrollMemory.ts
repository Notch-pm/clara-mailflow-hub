import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

/**
 * Position de défilement retenue par écran, pour le retour arrière.
 *
 * C'est l'élément passé en référence qui défile, pas la fenêtre : React Router
 * n'a donc AUCUNE prise dessus. Sans ce recalage, changer d'écran garde la
 * position du précédent — on arrive au milieu d'une liste, voire en dessous de
 * son contenu quand l'écran d'arrivée est plus court, puis on y retombe dès que
 * ses données arrivent et le rallongent.
 *
 * La position se retient AU FIL DU DÉFILEMENT, et non au moment de quitter
 * l'écran : à cet instant le nouvel écran est déjà monté, souvent encore vide,
 * et le navigateur a donc déjà ramené le conteneur vers le haut — on n'aurait
 * plus rien à mémoriser.
 */
export function useScrollMemory(ref: RefObject<HTMLElement>) {
  const { pathname } = useLocation();
  const navigationType = useNavigationType();
  const offsets = useRef(new Map<string, number>());
  const currentPath = useRef(pathname);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const remember = () => offsets.current.set(currentPath.current, node.scrollTop);
    node.addEventListener("scroll", remember, { passive: true });
    return () => node.removeEventListener("scroll", remember);
  }, [ref]);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    currentPath.current = pathname;
    // Un retour arrière rend l'écran tel qu'on l'avait laissé ; une navigation
    // avant commence en haut.
    const target = navigationType === "POP" ? (offsets.current.get(pathname) ?? 0) : 0;
    node.scrollTop = target;
    if (!target) return;
    // Les listes se remplissent APRÈS ce rendu : la position ne tient que si
    // l'on repasse une fois la hauteur connue.
    const id = window.setTimeout(() => {
      node.scrollTop = Math.min(target, node.scrollHeight - node.clientHeight);
    }, 300);
    return () => window.clearTimeout(id);
  }, [ref, pathname, navigationType]);
}
