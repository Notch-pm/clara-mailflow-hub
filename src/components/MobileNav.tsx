import { NavLink } from "@/components/NavLink";
import { Home, Send, FileClock, CheckCircle2, Archive, Mailbox, Inbox, BarChart3, Trash2, LucideIcon } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { isServiceCourrier, navItemVisible } from "@/lib/permissions";

interface NavItem {
  title: string;
  url: string;
  icon: LucideIcon;
}

const baseNavItems: NavItem[] = [
  { title: "Accueil", url: "/", icon: Home },
  { title: "Entrant", url: "/courrier-entrant", icon: Inbox },
  { title: "À instruire", url: "/a-instruire", icon: Mailbox },
  { title: "Instruction", url: "/courriers-en-instruction", icon: FileClock },
  { title: "Traités", url: "/courriers-traites", icon: CheckCircle2 },
  { title: "Archivés", url: "/courriers-archives", icon: Archive },
  { title: "Sortants", url: "/courriers-sortants", icon: Send },
  { title: "Stats", url: "/statistiques", icon: BarChart3 },
  { title: "Corbeille", url: "/corbeille", icon: Trash2 },
];

const MAILROOM_ONLY = new Set(["/courrier-entrant", "/corbeille"]);

export function MobileNav() {
  const { profile, membership } = useAuth();
  // Barre étroite : « Entrant » et « Corbeille » n'y figurent que pour le
  // gestionnaire courrier, pas pour l'administrateur qui garde la boîte aux lettres.
  const navItems = baseNavItems.filter(
    (it) =>
      navItemVisible(it.url, profile, membership) &&
      (!MAILROOM_ONLY.has(it.url) || isServiceCourrier(membership)),
  );
  return (
    <nav aria-label="Navigation principale" className="fixed bottom-0 left-0 right-0 z-40 border-t py-1.5 md:hidden bg-rail">
      <ul className="flex items-center justify-around">

        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <li key={item.url}>
              <NavLink
                to={item.url}
                end={item.url === "/"}
                className="flex flex-col items-center justify-center gap-0.5 px-2 py-1 min-h-11 min-w-11 rounded-lg transition-colors text-rail-foreground/70 hover:text-rail-foreground hover:bg-rail-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rail-foreground"
                activeClassName="!text-rail-foreground !bg-rail-foreground/20"
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
