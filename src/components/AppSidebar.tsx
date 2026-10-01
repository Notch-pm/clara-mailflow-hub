import { NavLink } from "@/components/NavLink";
import { Home, Send, FileClock, Users, CheckCircle2, Archive, Search, Mailbox, Inbox, BarChart3, Trash2, Signature, LucideIcon } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAuth } from "@/contexts/AuthContext";
import { navItemVisible } from "@/lib/permissions";
import { useEluSignatureQueue } from "@/hooks/useEluSignatureQueue";
import { useEluVisaQueue } from "@/hooks/useEluVisaQueue";

interface NavItem {
  title: string;
  url: string;
  icon: LucideIcon;
}

const baseNavItems: NavItem[] = [
  { title: "Tableau de bord", url: "/", icon: Home },
  { title: "Courrier entrant", url: "/courrier-entrant", icon: Inbox },
  { title: "Boîte aux lettres", url: "/boite-aux-lettres", icon: Mailbox },
  { title: "Courriers en instruction", url: "/courriers-en-instruction", icon: FileClock },
  { title: "Parapheur", url: "/parapheur", icon: Signature },
  { title: "Courriers traités", url: "/courriers-traites", icon: CheckCircle2 },
  { title: "Courriers archivés", url: "/courriers-archives", icon: Archive },
  { title: "Courriers sortants", url: "/courriers-sortants", icon: Send },
  { title: "Contacts", url: "/contacts", icon: Users },
  { title: "Recherche", url: "/recherche", icon: Search },
  { title: "Statistiques", url: "/statistiques", icon: BarChart3 },
  { title: "Corbeille et spam", url: "/corbeille", icon: Trash2 },
];

/**
 * Ce qui attend MON visa ou MA signature — les réponses qu'un autre viseur est
 * attendu pour viser n'y comptent pas. Monté seulement quand l'entrée est
 * visible : les files ne se chargent pas pour qui ne vise ni ne signe.
 */
function ParapheurBadge() {
  const visa = useEluVisaQueue();
  const signature = useEluSignatureQueue();
  const count = visa.items.filter((i) => !i.designatedToOther).length + signature.count;
  if (count === 0) return null;
  return (
    <span
      aria-hidden="true"
      className="absolute -right-[5px] -top-[3px] grid h-[17px] min-w-[17px] place-items-center rounded-full border-2 border-rail bg-secondary px-1 text-[10.5px] font-extrabold tabular-nums text-secondary-foreground"
    >
      {count}
    </span>
  );
}

function SidebarItem({ item }: { item: NavItem }) {
  const Icon = item.icon;
  const isParapheur = item.url === "/parapheur";
  return (
    <li>
      <Tooltip>
        <TooltipTrigger asChild>
          <NavLink
            to={item.url}
            end={item.url === "/"}
            className="relative flex items-center justify-center w-9 h-9 rounded-lg transition-colors text-rail-foreground/70 hover:text-rail-foreground hover:bg-rail-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rail-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-rail"
            activeClassName="!text-rail-foreground !bg-rail-foreground/20"
          >
            <Icon className="h-5 w-5" aria-hidden="true" />
            <span className="sr-only">{item.title}</span>
            {isParapheur && <ParapheurBadge />}
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
  const { profile, membership } = useAuth();
  const navItems = baseNavItems.filter((it) => navItemVisible(it.url, profile, membership));
  return (
    <TooltipProvider delayDuration={150}>
      <nav aria-label="Navigation principale" className="hidden md:flex flex-col items-center w-[52px] shrink-0 py-3 bg-rail h-full relative">
        {/* Tableau de bord épinglé tout en haut du rail */}
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
