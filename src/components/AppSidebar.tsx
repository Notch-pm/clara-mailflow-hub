import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { NavLink } from "@/components/NavLink";
import {
  Home,
  Send,
  FileClock,
  Users,
  CheckCircle2,
  Archive,
  Search,
  Mailbox,
  Inbox,
  BarChart3,
  Trash2,
  Signature,
  ChevronRight,
  LucideIcon,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@/contexts/AuthContext";
import { navItemVisible } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { useEluSignatureQueue } from "@/hooks/useEluSignatureQueue";
import { useEluVisaQueue } from "@/hooks/useEluVisaQueue";

interface NavItem {
  title: string;
  url: string;
  icon: LucideIcon;
}

interface NavGroup {
  id: string;
  title: string;
  icon: LucideIcon;
  items: NavItem[];
}

const HOME: NavItem = { title: "Tableau de bord", url: "/", icon: Home };

/**
 * Le rail suit les étapes de vie d'un courrier. Chaque étape ouvre une bulle
 * listant ses entrées ; une étape réduite à une seule entrée visible devient un
 * lien direct, une étape vide disparaît.
 */
const GROUPS: NavGroup[] = [
  {
    id: "reception",
    title: "Réception",
    icon: Inbox,
    items: [
      { title: "Courrier entrant", url: "/courrier-entrant", icon: Inbox },
      { title: "À instruire", url: "/a-instruire", icon: Mailbox },
    ],
  },
  {
    id: "traitement",
    title: "Traitement",
    icon: FileClock,
    items: [
      { title: "En instruction", url: "/courriers-en-instruction", icon: FileClock },
      { title: "Parapheur", url: "/parapheur", icon: Signature },
    ],
  },
  {
    id: "cloture",
    title: "Clôture",
    icon: CheckCircle2,
    items: [
      { title: "Traités", url: "/courriers-traites", icon: CheckCircle2 },
      { title: "Archivés", url: "/courriers-archives", icon: Archive },
      { title: "Corbeille et spam", url: "/corbeille", icon: Trash2 },
    ],
  },
];

const DIRECT_ITEMS: NavItem[] = [
  { title: "Courriers sortants", url: "/courriers-sortants", icon: Send },
  { title: "Contacts", url: "/contacts", icon: Users },
  { title: "Recherche", url: "/recherche", icon: Search },
  { title: "Statistiques", url: "/statistiques", icon: BarChart3 },
];

const PARAPHEUR_URL = "/parapheur";

const railButtonClass =
  "relative flex items-center justify-center w-9 h-9 rounded-lg transition-colors text-rail-foreground/70 hover:text-rail-foreground hover:bg-rail-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rail-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-rail";
const railActiveClass = "!text-rail-foreground !bg-rail-foreground/20";
/** Bulle ouverte : contour, distinct du fond plein de la page courante. */
const railOpenClass = "text-rail-foreground ring-1 ring-inset ring-rail-foreground/60";

function isRouteActive(pathname: string, url: string): boolean {
  if (url === "/") return pathname === "/";
  return pathname === url || pathname.startsWith(`${url}/`);
}

/**
 * Ce qui attend MON visa ou MA signature — les réponses qu'un autre viseur est
 * attendu pour viser n'y comptent pas. Les composants qui l'appellent ne sont
 * montés que quand l'entrée Parapheur est visible : les files ne se chargent
 * pas pour qui ne vise ni ne signe.
 */
function useParapheurCount(): number {
  const visa = useEluVisaQueue();
  const signature = useEluSignatureQueue();
  return visa.items.filter((i) => !i.designatedToOther).length + signature.count;
}

/** Pastille sur l'icône d'étape ou de lien direct : il y a du travail en attente. */
function ParapheurDot() {
  const count = useParapheurCount();
  if (count === 0) return null;
  return (
    <span
      aria-hidden="true"
      className="absolute -right-[3px] -top-[2px] h-2.5 w-2.5 rounded-full border-2 border-rail bg-secondary"
    />
  );
}

/** Compteur à côté de l'entrée Parapheur dans la bulle. */
function ParapheurCountBadge() {
  const count = useParapheurCount();
  if (count === 0) return null;
  return (
    <span className="rounded-full bg-secondary px-[7px] py-px text-[11px] font-extrabold tabular-nums text-secondary-foreground">
      {count}
    </span>
  );
}

function RailTooltip({
  title,
  disabled = false,
  children,
}: {
  title: string;
  /** Rubrique dont la bulle est ouverte : son titre est déjà affiché. */
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Tooltip open={open && !disabled} onOpenChange={setOpen}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      {/* Au-dessus d'une bulle ouverte (même z-50 sinon, et portée avant elle). */}
      <TooltipContent side="right" className="z-[60] font-medium">
        {title}
      </TooltipContent>
    </Tooltip>
  );
}

function SidebarItem({ item }: { item: NavItem }) {
  const Icon = item.icon;
  return (
    <li>
      <RailTooltip title={item.title}>
        <NavLink to={item.url} end={item.url === "/"} className={railButtonClass} activeClassName={railActiveClass}>
          <Icon className="h-5 w-5" aria-hidden="true" />
          <span className="sr-only">{item.title}</span>
          {item.url === PARAPHEUR_URL && <ParapheurDot />}
        </NavLink>
      </RailTooltip>
    </li>
  );
}

function SidebarGroup({ group, items }: { group: NavGroup; items: NavItem[] }) {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const Icon = group.icon;
  const hasParapheur = items.some((it) => it.url === PARAPHEUR_URL);
  const active = items.some((it) => isRouteActive(pathname, it.url));

  // Toute navigation referme la bulle.
  useEffect(() => setOpen(false), [pathname]);

  return (
    <li>
      <Popover open={open} onOpenChange={setOpen}>
        <RailTooltip title={group.title} disabled={open}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={group.title}
              className={cn(railButtonClass, active && railActiveClass, open && railOpenClass)}
            >
              <Icon className="h-5 w-5" aria-hidden="true" />
              {/* Sur le fond du rail, hors du fond de l'icône ; la pointe de la bulle le remplace une fois ouverte. */}
              <ChevronRight
                className={cn(
                  "absolute -right-2 top-1/2 h-2.5 w-2.5 -translate-y-1/2 transition-opacity",
                  open ? "opacity-0" : "opacity-[0.55]",
                )}
                strokeWidth={3}
                aria-hidden="true"
              />
              {hasParapheur && <ParapheurDot />}
            </button>
          </PopoverTrigger>
        </RailTooltip>
        <PopoverContent
          side="right"
          align="center"
          sideOffset={9}
          className="relative w-[210px] rounded-xl bg-card p-2 shadow-lg"
        >
          {/* Pointe vers l'étape : la bulle part du rail. */}
          <span
            aria-hidden="true"
            className="absolute -left-[6px] top-1/2 h-2.5 w-2.5 -translate-y-1/2 rotate-45 border-b border-l border-border bg-card"
          />
          <p className="px-2.5 pb-1.5 pt-0.5 text-xs font-extrabold text-muted-foreground">{group.title}</p>
          <ul className="flex flex-col gap-0.5">
            {items.map((item) => {
              const ItemIcon = item.icon;
              return (
                <li key={item.url}>
                  <NavLink
                    to={item.url}
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    activeClassName="!bg-primary/10 !text-primary"
                  >
                    <ItemIcon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
                    <span className="flex-1 text-left">{item.title}</span>
                    {item.url === PARAPHEUR_URL && <ParapheurCountBadge />}
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </PopoverContent>
      </Popover>
    </li>
  );
}

export function AppSidebar() {
  const { profile, membership } = useAuth();
  const visible = (it: NavItem) => navItemVisible(it.url, profile, membership);

  const groups = GROUPS.map((g) => ({ group: g, items: g.items.filter(visible) })).filter(
    (g) => g.items.length > 0,
  );
  const directItems = DIRECT_ITEMS.filter(visible);

  return (
    <TooltipProvider delayDuration={150}>
      <nav aria-label="Navigation principale" className="hidden md:flex flex-col items-center w-[52px] shrink-0 py-3 bg-rail h-full relative">
        {/* Tableau de bord épinglé tout en haut du rail */}
        <ul className="contents">
          <SidebarItem item={HOME} />
        </ul>

        <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 pointer-events-none">
          <ul className="pointer-events-auto flex flex-col items-center gap-0.5">
            {groups.map(({ group, items }) =>
              items.length === 1 ? (
                <SidebarItem key={items[0].url} item={items[0]} />
              ) : (
                <SidebarGroup key={group.id} group={group} items={items} />
              ),
            )}
          </ul>
          {groups.length > 0 && directItems.length > 0 && (
            <div aria-hidden="true" className="my-[7px] h-px w-5 bg-rail-foreground/20" />
          )}
          <ul className="pointer-events-auto flex flex-col items-center gap-0.5">
            {directItems.map((item) => (
              <SidebarItem key={item.url} item={item} />
            ))}
          </ul>
        </div>
      </nav>
    </TooltipProvider>
  );
}
