import { Outlet } from "react-router-dom";
import { AppSidebar } from "@/components/AppSidebar";
import { AppHeader } from "@/components/AppHeader";
import { MobileNav } from "@/components/MobileNav";
import { useIsMobile } from "@/hooks/use-mobile";

export function AppLayout() {
  const isMobile = useIsMobile();

  return (
    <div className="h-screen flex flex-col w-full overflow-hidden">
      <AppHeader />

      <div className="flex-1 flex min-h-0 overflow-hidden">
        {!isMobile && <AppSidebar />}

        <main className="flex-1 overflow-auto p-4 md:p-6 pb-20 md:pb-6">
          <Outlet />
        </main>
      </div>

      {isMobile && <MobileNav />}
    </div>
  );
}
