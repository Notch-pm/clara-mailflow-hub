import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CounterTab<K extends string> {
  key: K;
  label: string;
  icon: LucideIcon;
  count: number;
  /** Ligne du dessous : un indice, ou une alerte (`subTone: "destructive"`). */
  sub: ReactNode;
  subTone?: "muted" | "destructive";
  /** Carte mise en avant : le travail qui ne se fera pas seul. */
  hero?: boolean;
  /** Libellé et nombre en orange : quelque chose demande l'attention. */
  warn?: boolean;
}

/**
 * Compteurs-onglets : chaque carte est un compteur ET l'onglet de sa vue
 * (Courrier entrant, Courriers sortants). La grille est donnée par l'écran,
 * qui seul sait combien de cartes il aligne.
 */
export function CounterTabs<K extends string>({
  tabs,
  value,
  onChange,
  ariaLabel,
  className,
}: {
  tabs: CounterTab<K>[];
  value: K;
  onChange: (key: K) => void;
  ariaLabel: string;
  className: string;
}) {
  return (
    <div role="tablist" aria-label={ariaLabel} className={cn("grid shrink-0 gap-2 border-b px-4 py-2.5 md:px-5", className)}>
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const on = value === tab.key;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(tab.key)}
            className={cn(
              "flex min-w-0 flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left transition-shadow hover:shadow-airbnb",
              tab.hero ? "border-warning/50 bg-secondary/25" : "bg-card",
              on && "border-primary ring-1 ring-primary",
            )}
          >
            <span
              className={cn(
                "flex max-w-full items-center gap-1.5 truncate text-xs font-semibold",
                tab.hero ? "text-secondary-foreground" : tab.warn ? "text-warning" : "text-muted-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              {tab.label}
            </span>
            <span
              className={cn(
                "font-bold leading-tight tabular-nums",
                tab.hero ? "text-2xl" : "text-xl",
                tab.warn ? "text-warning" : "text-foreground",
              )}
            >
              {tab.count.toLocaleString("fr-FR")}
            </span>
            {tab.subTone === "destructive" ? (
              <span className="flex max-w-full items-center gap-1 truncate text-[11.5px] font-semibold text-destructive">
                {tab.sub}
              </span>
            ) : (
              <span className="max-w-full truncate text-[11.5px] text-muted-foreground">{tab.sub}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
