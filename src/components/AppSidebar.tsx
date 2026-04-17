import { NavLink } from "@/components/NavLink";
import { LayoutDashboard, Send, Link2, FileClock, Users, CheckCircle2, LucideIcon } from "lucide-react";
import mailboxIcon from "@/assets/icons/mailbox.svg";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface NavItem {
  title: string;
  url: string;
  icon?: LucideIcon;
  svgIcon?: string;
}

const navItems: NavItem[] = [
  { title: "Tableau de bord", url: "/", icon: LayoutDashboard },
  { title: "Boîte aux lettres", url: "/boite-aux-lettres", svgIcon: mailboxIcon },
  { title: "Courriers en instruction", url: "/courriers-en-instruction", icon: FileClock },
  { title: "Courriers traités", url: "/courriers-traites", icon: CheckCircle2 },
  { title: "Courriers sortants", url: "/courriers-sortants", icon: Send },
  { title: "Usagers", url: "/usagers", icon: Users },
  { title: "Liens externes", url: "/liens", icon: Link2 },
];

function SidebarItem({ item }: { item: NavItem }) {
  const Icon = item.icon;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <NavLink
          to={item.url}
          end={item.url === "/"}
          className="flex items-center justify-center w-9 h-9 rounded-lg transition-colors text-primary-foreground/70 hover:text-primary-foreground hover:bg-primary-foreground/10"
          activeClassName="!text-primary-foreground !bg-primary-foreground/20"
        >
          {item.svgIcon ? (
            <img src={item.svgIcon} alt="" className="h-5 w-5 brightness-0 invert opacity-70" />
          ) : Icon ? (
            <Icon className="h-5 w-5" />
          ) : null}
        </NavLink>
      </TooltipTrigger>
      <TooltipContent side="right" className="font-medium">
        {item.title}
      </TooltipContent>
    </Tooltip>
  );
}

export function AppSidebar() {
  return (
    <TooltipProvider delayDuration={150}>
      <nav className="hidden md:flex flex-col items-center w-[52px] shrink-0 py-3 bg-primary h-full relative">
        <SidebarItem item={navItems[0]} />

        <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 pointer-events-none">
          <div className="pointer-events-auto flex flex-col items-center gap-0.5">
            {navItems.slice(1).map((item) => (
              <SidebarItem key={item.url} item={item} />
            ))}
          </div>
        </div>
      </nav>
    </TooltipProvider>
  );
}
