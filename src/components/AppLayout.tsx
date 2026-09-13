import { useRef } from "react";
import { Outlet } from "react-router-dom";
import { AppSidebar } from "@/components/AppSidebar";
import { AppHeader } from "@/components/AppHeader";
import { MobileNav } from "@/components/MobileNav";
import { EluReturnBanner } from "@/components/elu/EluReturnBanner";
import { useIsMobile } from "@/hooks/use-mobile";
import { useScrollMemory } from "@/hooks/useScrollMemory";

export function AppLayout() {
  const isMobile = useIsMobile();
  const mainRef = useRef<HTMLElement>(null);
  useScrollMemory(mainRef);

  return (
    <div className="h-dvh flex flex-col w-full overflow-hidden">
      <AppHeader />

      <div className="flex-1 flex min-h-0 overflow-hidden">
        {!isMobile && <AppSidebar />}

        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* Un élu arrivé ici par un lien profond (notification) garde son
              écran, mais doit pouvoir regagner son espace en un geste. */}
          <EluReturnBanner />

          {/* La gouttière de TOUS les écrans se pose ici, et nulle part ailleurs :
              une page qui remettait la sienne par-dessus se retrouvait avec le
              double (48 px au lieu de 24). Le bas garde sa réserve sous `md` :
              la barre de navigation mobile est fixe, le contenu passerait
              dessous. Les classes précédentes se neutralisaient entre elles —
              `px-0 py-0` annulait `p-4` — ce qui collait le contenu aux bords
              sur mobile.

              Seule exception : les pages de liste (`ListPage`, reconnues à
              `data-list-page`) occupent toute la zone, bord à bord, et ne
              laissent défiler que leurs lignes. `main` retire alors sa
              gouttière — sauf la réserve basse sous `md` — et cesse de
              défiler, sans quoi page et tableau défileraient l'un dans
              l'autre. */}
          <main
            ref={mainRef}
            className="flex-1 overflow-auto p-4 pb-20 has-[>[data-list-page]]:overflow-hidden has-[>[data-list-page]]:px-0 has-[>[data-list-page]]:pt-0 md:p-6 md:pb-6 md:has-[>[data-list-page]]:pb-0"
          >
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
