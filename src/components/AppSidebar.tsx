import { NavLink } from "@/components/NavLink";
import { LayoutDashboard, Send, FileClock, Users, CheckCircle2, Archive, Search, Mailbox, LucideIcon } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface NavItem {
  title: string;
  url: string;
  icon: LucideIcon;
}

const navItems: NavItem[] = [
  { title: "Tableau de bord", url: "/", icon: LayoutDashboard },
  { title: "Boîte aux lettres", url: "/boite-aux-lettres", icon: Mailbox },
  { title: "Courriers en instruction", url: "/courriers-en-instruction", icon: FileClock },
  { title: "Courriers traités", url: "/courriers-traites", icon: CheckCircle2 },
  { title: "Courriers archivés", url: "/courriers-archives", icon: Archive },
  { title: "Courriers sortants", url: "/courriers-sortants", icon: Send },
  { title: "Usagers", url: "/usagers", icon: Users },
  { title: "Recherche", url: "/recherche", icon: Search },
];

function SidebarItem({ item }: { item: NavItem }) {
  const Icon = item.icon;
  return (
    <li>
      <Tooltip>
        <TooltipTrigger asChild>
          <NavLink
            to={item.url}
            end={item.url === "/"}
            className="flex items-center justify-center w-9 h-9 rounded-lg transition-colors text-primary-foreground/70 hover:text-primary-foreground hover:bg-primary-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-primary"
            activeClassName="!text-primary-foreground !bg-primary-foreground/20"
          >
            <Icon className="h-5 w-5" aria-hidden="true" />
            <span className="sr-only">{item.title}</span>
          </NavLink>
        </TooltipTrigger>
        <TooltipContent side="right" className="font-medium">
          {item.title}
        </TooltipContent>
      </Tooltip>
    </li>
  );
}

export function AppSidebar() {
  return (
    <TooltipProvider delayDuration={150}>
      <nav aria-label="Navigation principale" className="hidden md:flex flex-col items-center w-[52px] shrink-0 py-3 bg-primary h-full relative">
        <ul className="contents">
          <SidebarItem item={navItems[0]} />
        </ul>

        <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 pointer-events-none">
          <ul className="pointer-events-auto flex flex-col items-center gap-0.5">
            {navItems.slice(1).map((item) => (
              <SidebarItem key={item.url} item={item} />
            ))}
          </ul>
        </div>
      </nav>
    </TooltipProvider>
  );
}
