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
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
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
function ParapheurDot({ onTab = false }: { onTab?: boolean }) {
  const count = useParapheurCount();
  if (count === 0) return null;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "absolute z-[2] h-2.5 w-2.5 rounded-full border-2 bg-secondary",
        // Bulle ouverte : la pastille rentre dans l'onglet, cerclée de sa couleur.
        onTab ? "right-[5px] top-[5px] border-card" : "-right-[3px] -top-[2px] border-rail",
      )}
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
              className={cn(
                railButtonClass,
                open
                  ? "z-[11] !bg-transparent !text-rail hover:!bg-transparent dark:!text-foreground"
                  : active && railActiveClass,
              )}
            >
              {open && (
                <>
                  {/* Onglet : l'étape ouverte se prolonge dans la bulle, de la
                      même couleur, avec deux coins rentrants pour la jonction. */}
                  <span aria-hidden="true" className="absolute left-0 top-0 h-9 w-[45px] rounded-l-[10px] bg-card" />
                  <span
                    aria-hidden="true"
                    className="absolute -top-2.5 left-[34px] h-2.5 w-2.5 bg-[radial-gradient(circle_at_0_0,transparent_10px,hsl(var(--card))_10.5px)]"
                  />
                  <span
                    aria-hidden="true"
                    className="absolute -bottom-2.5 left-[34px] h-2.5 w-2.5 bg-[radial-gradient(circle_at_0_100%,transparent_10px,hsl(var(--card))_10.5px)]"
                  />
                </>
              )}
              <Icon className="relative z-[1] h-5 w-5" aria-hidden="true" />
              {!open && (
                <ChevronRight
                  className="absolute -right-[9px] top-[13px] h-2.5 w-2.5 opacity-60"
                  strokeWidth={2.5}
                  aria-hidden="true"
                />
              )}
              {hasParapheur && <ParapheurDot onTab={open} />}
            </button>
          </PopoverTrigger>
        </RailTooltip>
        {/* Pas de portail : la bulle doit passer SOUS l'onglet du bouton
            (z-10 contre z-11) pour que les deux ne fassent qu'un. */}
        <PopoverPrimitive.Content
          side="right"
          align="center"
          sideOffset={8}
          className="z-10 flex w-[210px] flex-col rounded-r-[14px] border border-l-0 bg-card px-2 py-2.5 text-foreground shadow-2xl outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0"
        >
          <p className="px-2.5 pb-1.5 pt-0.5 text-xs font-extrabold text-muted-foreground">{group.title}</p>
          <ul className="flex flex-col gap-0.5">
            {items.map((item) => {
              const ItemIcon = item.icon;
              return (
                <li key={item.url}>
                  <NavLink
                    to={item.url}
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-semibold text-rail transition-colors hover:bg-muted dark:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    activeClassName="!bg-rail/10 dark:!bg-muted"
                  >
                    <ItemIcon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
                    <span className="flex-1 text-left">{item.title}</span>
                    {item.url === PARAPHEUR_URL && <ParapheurCountBadge />}
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </PopoverPrimitive.Content>
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
      <nav aria-label="Navigation principale" className="hidden md:flex flex-col items-center w-[52px] shrink-0 py-3 bg-rail h-full relative z-30">
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
