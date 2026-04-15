import { useLocation } from "react-router-dom";
import { NavLink } from "@/components/NavLink";
import { LayoutDashboard, MailOpen, Send, Link2, GitBranch } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const navItems = [
  { title: "Tableau de bord", url: "/", icon: LayoutDashboard },
  { title: "Courriers entrants", url: "/courriers-entrants", icon: MailOpen },
  { title: "Courriers sortants", url: "/courriers-sortants", icon: Send },
  { title: "Liens externes", url: "/liens", icon: Link2 },
  { title: "Workflows", url: "/workflows", icon: GitBranch },
];

export function AppSidebar() {
  const location = useLocation();

  const isActive = (url: string) =>
    url === "/" ? location.pathname === "/" : location.pathname.startsWith(url);

  return (
    <TooltipProvider delayDuration={150}>
      <nav className="hidden md:flex flex-col items-center w-[52px] shrink-0 py-3 bg-primary h-full relative">
        {/* First item pinned top */}
        <Tooltip>
          <TooltipTrigger asChild>
            <NavLink
              to={navItems[0].url}
              end
              className="flex items-center justify-center w-9 h-9 rounded-lg transition-colors text-primary-foreground/70 hover:text-primary-foreground hover:bg-primary-foreground/10"
              activeClassName="!text-primary-foreground !bg-primary-foreground/20"
            >
              <navItems[0].icon className="h-5 w-5" />
            </NavLink>
          </TooltipTrigger>
          <TooltipContent side="right" className="font-medium">
            {navItems[0].title}
          </TooltipContent>
        </Tooltip>

        {/* Remaining icons centered */}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 pointer-events-none">
          <div className="pointer-events-auto flex flex-col items-center gap-0.5">
            {navItems.slice(1).map((item) => (
              <Tooltip key={item.url}>
                <TooltipTrigger asChild>
                  <NavLink
                    to={item.url}
                    className="flex items-center justify-center w-9 h-9 rounded-lg transition-colors text-primary-foreground/70 hover:text-primary-foreground hover:bg-primary-foreground/10"
                    activeClassName="!text-primary-foreground !bg-primary-foreground/20"
                  >
                    <item.icon className="h-5 w-5" />
                  </NavLink>
                </TooltipTrigger>
                <TooltipContent side="right" className="font-medium">
                  {item.title}
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        </div>
      </nav>
    </TooltipProvider>
  );
}
