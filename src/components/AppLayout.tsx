import { useEffect, useLayoutEffect, useRef } from "react";
import { Outlet, useLocation, useNavigationType } from "react-router-dom";
import { AppSidebar } from "@/components/AppSidebar";
import { AppHeader } from "@/components/AppHeader";
import { MobileNav } from "@/components/MobileNav";
import { useIsMobile } from "@/hooks/use-mobile";

export function AppLayout() {
  const isMobile = useIsMobile();
  const mainRef = useRef<HTMLElement>(null);
  const { pathname } = useLocation();
  const navigationType = useNavigationType();
  /** Position de défilement laissée sur chaque écran, pour le retour arrière. */
  const offsets = useRef(new Map<string, number>());
  const currentPath = useRef(pathname);

  // La position se retient AU FIL DU DÉFILEMENT, et non au moment de quitter
  // l'écran : à cet instant le nouvel écran est déjà monté, souvent encore vide,
  // et le navigateur a donc déjà ramené `main` vers le haut — on n'aurait plus
  // rien à mémoriser.
  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    const remember = () => offsets.current.set(currentPath.current, main.scrollTop);
    main.addEventListener("scroll", remember, { passive: true });
    return () => main.removeEventListener("scroll", remember);
  }, []);

  // C'est `main` qui défile, pas la fenêtre : React Router n'a donc AUCUNE prise
  // dessus. Sans ce recalage, changer d'écran garde la position de l'écran
  // précédent — on arrive au milieu d'une liste, voire en dessous de son
  // contenu quand l'écran d'arrivée est plus court, puis on y retombe dès que
  // ses données arrivent et le rallongent.
  useLayoutEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    currentPath.current = pathname;
    // Un retour arrière rend l'écran tel qu'on l'avait laissé ; une navigation
    // avant commence en haut.
    const target = navigationType === "POP" ? (offsets.current.get(pathname) ?? 0) : 0;
    main.scrollTop = target;
    if (!target) return;
    // Les listes se remplissent APRÈS ce rendu : la position ne tient que si
    // l'on repasse une fois la hauteur connue.
    const id = window.setTimeout(() => {
      main.scrollTop = Math.min(target, main.scrollHeight - main.clientHeight);
    }, 300);
    return () => window.clearTimeout(id);
  }, [pathname, navigationType]);

  return (
    <div className="h-dvh flex flex-col w-full overflow-hidden">
      <AppHeader />

      <div className="flex-1 flex min-h-0 overflow-hidden">
        {!isMobile && <AppSidebar />}

        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <main ref={mainRef} className="flex-1 overflow-auto p-4 md:p-6 pb-20 md:pb-6 px-0 py-0">
            <Outlet />
          </main>

          {!isMobile && (
            <footer className="hidden md:flex flex-shrink-0 items-center justify-end gap-4 px-4 py-1.5 border-t bg-background text-[11px] text-muted-foreground">
              <a
                href="/accessibilite"
                target="_blank"
                rel="noopener noreferrer"
                className="underline-offset-4 hover:underline"
              >
                Déclaration d'accessibilité
              </a>
            </footer>
          )}
        </div>
      </div>

      {isMobile && <MobileNav />}
    </div>
  );
}
