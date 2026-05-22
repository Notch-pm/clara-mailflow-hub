import { NavLink } from "@/components/NavLink";
import { LayoutDashboard, Send, FileClock, CheckCircle2, Archive, Mailbox, LucideIcon } from "lucide-react";

interface NavItem {
  title: string;
  url: string;
  icon: LucideIcon;
}

const navItems: NavItem[] = [
  { title: "Accueil", url: "/", icon: LayoutDashboard },
  { title: "Boîte", url: "/boite-aux-lettres", icon: Mailbox },
  { title: "Instruction", url: "/courriers-en-instruction", icon: FileClock },
  { title: "Traités", url: "/courriers-traites", icon: CheckCircle2 },
  { title: "Archivés", url: "/courriers-archives", icon: Archive },
  { title: "Sortants", url: "/courriers-sortants", icon: Send },
];

export function MobileNav() {
  return (
    <nav aria-label="Navigation principale" className="fixed bottom-0 left-0 right-0 z-40 border-t py-1.5 md:hidden bg-primary">
      <ul className="flex items-center justify-around">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <li key={item.url}>
              <NavLink
                to={item.url}
                end={item.url === "/"}
                className="flex flex-col items-center justify-center gap-0.5 px-2 py-1 min-h-11 min-w-11 rounded-lg transition-colors text-primary-foreground/70 hover:text-primary-foreground hover:bg-primary-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground"
                activeClassName="!text-primary-foreground !bg-primary-foreground/20"
              >
                <Icon className="h-5 w-5" aria-hidden="true" />
                <span className="text-[9px] leading-tight text-center font-medium">
                  {item.title}
                </span>
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
