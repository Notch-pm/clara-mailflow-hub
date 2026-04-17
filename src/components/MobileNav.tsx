import { NavLink } from "@/components/NavLink";
import { LayoutDashboard, Send, Link2, FileClock, LucideIcon } from "lucide-react";
import mailboxIcon from "@/assets/icons/mailbox.svg";

interface NavItem {
  title: string;
  url: string;
  icon?: LucideIcon;
  svgIcon?: string;
}

const navItems: NavItem[] = [
  { title: "Accueil", url: "/", icon: LayoutDashboard },
  { title: "Boîte", url: "/boite-aux-lettres", svgIcon: mailboxIcon },
  { title: "Instruction", url: "/courriers-en-instruction", icon: FileClock },
  { title: "Sortants", url: "/courriers-sortants", icon: Send },
  { title: "Liens", url: "/liens", icon: Link2 },
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
            {item.svgIcon ? (
              <img src={item.svgIcon} alt="" className="h-5 w-5 brightness-0 invert opacity-70" />
            ) : Icon ? (
              <Icon className="h-5 w-5" />
            ) : null}
            <span className="text-[9px] leading-tight text-center font-medium">
              {item.title}
            </span>
          </NavLink>
        );
      })}
    </nav>
  );
}
