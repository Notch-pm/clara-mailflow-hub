import { Outlet } from "react-router-dom";
import { AppSidebar } from "@/components/AppSidebar";
import { AppHeader } from "@/components/AppHeader";
import { MobileNav } from "@/components/MobileNav";
import { useIsMobile } from "@/hooks/use-mobile";

export function AppLayout() {
  const isMobile = useIsMobile();

  return (
    <div className="h-dvh flex flex-col w-full overflow-hidden">
      <AppHeader />

      <div className="flex-1 flex min-h-0 overflow-hidden">
        {!isMobile && <AppSidebar />}

        <main className="flex-1 overflow-auto p-4 md:p-6 pb-20 md:pb-6 px-0 py-0">
          <Outlet />
        </main>
      </div>

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

      {isMobile && <MobileNav />}
    </div>
  );
}
