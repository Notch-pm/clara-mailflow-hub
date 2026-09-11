import { useLayoutEffect, useRef, useState } from "react";

/**
 * Taille réelle du conteneur de carte (le rendu des tuiles en dépend).
 *
 * ⚠️ La mesure se fait au MONTAGE : l'élément doit exister au premier rendu du
 * composant qui appelle ce hook. Un conteneur rendu conditionnellement plus
 * tard ne sera jamais mesuré, et sa mosaïque restera vide — monter le composant
 * entier quand la condition est vraie, plutôt que masquer le conteneur.
 */
export function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { ref, width: size.width, height: size.height };
}
