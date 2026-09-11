import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

export type ResponsiveTabItem = {
  value: string;
  label: React.ReactNode;
  /** Compteur affiché en pastille à droite du libellé (masqué si 0 ou absent). */
  count?: number | null;
  /** Complément libre (ex. état de la réponse), rendu après la pastille. */
  badge?: React.ReactNode;
};

type Props = {
  tabs: ResponsiveTabItem[];
  activeValue: string;
  /** Requis pour les onglets repliés dans « Autres » : ils ne sont pas des TabsTrigger. */
  onValueChange?: (value: string) => void;
  className?: string;
};

/** Espace horizontal entre deux onglets, en px — doit refléter le `gap-1` ci-dessous. */
const TAB_GAP = 4;

const triggerClass =
  "inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-t-md border-b-2 border-transparent px-3.5 pb-3 pt-2.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:text-foreground data-[state=active]:border-primary data-[state=active]:font-bold data-[state=active]:text-primary";

/** Pastille de comptage : elle prend la teinte de l'onglet actif. */
function CountPill({ value, active }: { value: number; active: boolean }) {
  return (
    <span
      className={cn(
        "inline-grid h-5 min-w-[20px] place-items-center rounded-full px-1.5 text-[11px] font-bold leading-none",
        active ? "bg-primary/12 text-primary" : "bg-muted text-muted-foreground",
      )}
    >
      {value}
    </span>
  );
}

export function ResponsiveTabsList({ tabs, activeValue, onValueChange, className }: Props) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const measureRef = React.useRef<HTMLDivElement | null>(null);
  const [visibleCount, setVisibleCount] = React.useState(tabs.length);
  // Sur un téléphone, la colonne de travail ne laisse la place qu'à UN onglet :
  // le repli mettait six onglets sur sept derrière « Autres », c'est-à-dire la
  // page entière dans un menu. La barre y défile donc horizontalement, motif
  // habituel des onglets sur mobile.
  const isMobile = useIsMobile();

  const recompute = React.useCallback(() => {
    const container = containerRef.current;
    const measure = measureRef.current;
    if (!container || !measure) return;
    const containerWidth = container.clientWidth;
    const items = Array.from(measure.children) as HTMLElement[];
    const moreWidth = 90;

    // First try: everything fits
    let total = 0;
    items.forEach((el, i) => {
      total += el.offsetWidth + (i > 0 ? TAB_GAP : 0);
    });
    if (total <= containerWidth) {
      setVisibleCount(tabs.length);
      return;
    }

    let used = 0;
    let count = 0;
    for (let i = 0; i < items.length; i++) {
      const w = items[i].offsetWidth + (i > 0 ? TAB_GAP : 0);
      if (used + w + TAB_GAP + moreWidth <= containerWidth) {
        used += w;
        count++;
      } else {
        break;
      }
    }
    setVisibleCount(Math.max(count, 1));
  }, [tabs.length]);

  React.useLayoutEffect(() => {
    recompute();
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(recompute);
    ro.observe(container);
    return () => ro.disconnect();
  }, [recompute]);

  let visible = isMobile ? tabs : tabs.slice(0, visibleCount);
  let overflow = isMobile ? [] : tabs.slice(visibleCount);

  // Ensure active tab is always visible
  if (overflow.some((t) => t.value === activeValue)) {
    const active = tabs.find((t) => t.value === activeValue)!;
    overflow = overflow.filter((t) => t.value !== activeValue);
    const displaced = visible[visible.length - 1];
    visible = [...visible.slice(0, -1), active];
    if (displaced && displaced.value !== active.value) {
      overflow = [displaced, ...overflow];
    }
  }

  React.useEffect(() => {
    if (!isMobile) return;
    const container = containerRef.current;
    const active = container?.querySelector<HTMLElement>('[data-state="active"]');
    active?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [isMobile, activeValue]);

  const contents = (t: ResponsiveTabItem) => (
    <>
      {t.label}
      {!!t.count && <CountPill value={t.count} active={t.value === activeValue} />}
      {t.badge}
    </>
  );

  return (
    <>
      <div
        ref={measureRef}
        aria-hidden
        className="flex gap-1"
        style={{
          position: "fixed",
          top: -9999,
          left: 0,
          visibility: "hidden",
          pointerEvents: "none",
        }}
      >
        {tabs.map((t) => (
          <span key={t.value} className={triggerClass}>
            {contents(t)}
          </span>
        ))}
      </div>

      <TabsPrimitive.List
        ref={containerRef}
        className={cn(
          "flex w-full items-center gap-1 border-b border-border",
          // `scrollbar-width`/`::-webkit-scrollbar` : la barre de défilement
          // masquerait le trait d'onglet actif, épais de 2 px seulement.
          isMobile &&
            "overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          className,
        )}
      >
        {visible.map((t) => (
          <TabsPrimitive.Trigger key={t.value} value={t.value} className={triggerClass}>
            {contents(t)}
          </TabsPrimitive.Trigger>
        ))}
        {overflow.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(
                "ml-auto inline-flex shrink-0 items-center gap-1 whitespace-nowrap border-b-2 border-transparent px-3.5 pb-3 pt-2.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none",
                overflow.some((t) => t.value === activeValue) && "border-primary text-primary",
              )}
            >
              Autres
              <ChevronDown className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {overflow.map((t) => (
                <DropdownMenuItem
                  key={t.value}
                  onSelect={() => onValueChange?.(t.value)}
                  className={cn(
                    "w-full cursor-pointer justify-start gap-2",
                    t.value === activeValue && "font-semibold text-primary",
                  )}
                >
                  {contents(t)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </TabsPrimitive.List>
    </>
  );
}
