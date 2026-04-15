import { NavLink } from "@/components/NavLink";
import { LayoutDashboard, MailOpen, Send, Link2, GitBranch, LucideIcon } from "lucide-react";

interface NavItem {
  title: string;
  url: string;
  icon: LucideIcon;
}

const navItems: NavItem[] = [
  { title: "Accueil", url: "/", icon: LayoutDashboard },
  { title: "Entrants", url: "/courriers-entrants", icon: MailOpen },
  { title: "Sortants", url: "/courriers-sortants", icon: Send },
  { title: "Liens", url: "/liens", icon: Link2 },
  { title: "Workflows", url: "/workflows", icon: GitBranch },
];

export function MobileNav() {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 flex items-center justify-around border-t py-1.5 md:hidden bg-primary">
      {navItems.map((item) => {
        const Icon = item.icon;
        return (
          <NavLink
            key={item.url}
            to={item.url}
            end={item.url === "/"}
            className="flex flex-col items-center justify-center gap-0.5 px-2 py-1 rounded-lg transition-colors text-primary-foreground/70 hover:text-primary-foreground hover:bg-primary-foreground/10"
            activeClassName="!text-primary-foreground !bg-primary-foreground/20"
          >
            <Icon className="h-5 w-5" />
            <span className="text-[9px] leading-tight text-center font-medium">
              {item.title}
            </span>
          </NavLink>
        );
      })}
    </nav>
  );
}
