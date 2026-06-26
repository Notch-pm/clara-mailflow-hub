import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export type ResponsiveTabItem = {
  value: string;
  label: React.ReactNode;
  badge?: React.ReactNode;
};

type Props = {
  tabs: ResponsiveTabItem[];
  activeValue: string;
  className?: string;
};

const triggerClass =
  "relative inline-flex items-center gap-2 whitespace-nowrap px-1 pt-2 pb-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:text-foreground data-[state=active]:text-primary after:absolute after:left-0 after:right-0 after:-bottom-px after:h-[2px] after:rounded-full after:bg-primary after:opacity-0 data-[state=active]:after:opacity-100";

export function ResponsiveTabsList({ tabs, activeValue, className }: Props) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const measureRef = React.useRef<HTMLDivElement | null>(null);
  const [visibleCount, setVisibleCount] = React.useState(tabs.length);

  const recompute = React.useCallback(() => {
    const container = containerRef.current;
    const measure = measureRef.current;
    if (!container || !measure) return;
    const containerWidth = container.clientWidth;
    const items = Array.from(measure.children) as HTMLElement[];
    const gap = 24; // gap-6
    const moreWidth = 90;

    // First try: everything fits
    let total = 0;
    items.forEach((el, i) => {
      total += el.offsetWidth + (i > 0 ? gap : 0);
    });
    if (total <= containerWidth) {
      setVisibleCount(tabs.length);
      return;
    }

    let used = 0;
    let count = 0;
    for (let i = 0; i < items.length; i++) {
      const w = items[i].offsetWidth + (i > 0 ? gap : 0);
      if (used + w + gap + moreWidth <= containerWidth) {
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

  let visible = tabs.slice(0, visibleCount);
  let overflow = tabs.slice(visibleCount);

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

  return (
    <>
      <div
        ref={measureRef}
        aria-hidden
        className="flex gap-6"
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
            {t.label}
            {t.badge}
          </span>
        ))}
      </div>

      <TabsPrimitive.List
        ref={containerRef}
        className={cn(
          "flex items-center gap-6 border-b border-border w-full px-1",
          className,
        )}
      >
        {visible.map((t) => (
          <TabsPrimitive.Trigger key={t.value} value={t.value} className={triggerClass}>
            {t.label}
            {t.badge}
          </TabsPrimitive.Trigger>
        ))}
        {overflow.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(
                "ml-auto inline-flex items-center gap-1 whitespace-nowrap px-1 pt-2 pb-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none",
                overflow.some((t) => t.value === activeValue) && "text-primary",
              )}
            >
              Autres
              <ChevronDown className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {overflow.map((t) => (
                <DropdownMenuItem key={t.value} asChild>
                  <TabsPrimitive.Trigger
                    value={t.value}
                    className="w-full justify-start gap-2 cursor-pointer data-[state=active]:text-primary data-[state=active]:font-semibold"
                  >
                    {t.label}
                    {t.badge}
                  </TabsPrimitive.Trigger>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </TabsPrimitive.List>
    </>
  );
}
