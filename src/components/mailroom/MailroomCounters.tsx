import { CircleCheck, ClockAlert, List, Route, Sparkles, TriangleAlert, Undo2, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { MAILROOM_VIEW_ORDER, MAILROOM_VIEWS, type MailroomCounts, type MailroomView } from "@/lib/mailroom";

const ICONS: Record<MailroomView, LucideIcon> = {
  aq: TriangleAlert,
  av: Sparkles,
  retour: Undo2,
  cours: Route,
  traites: CircleCheck,
  tous: List,
};

function hint(view: MailroomView, counts: MailroomCounts): string {
  switch (view) {
    case "aq":
      return "Action requise";
    case "av":
      return "Propositions à contrôler";
    case "retour":
      return "Travail restant à confier";
    case "cours":
      return "Routés, non clôturés";
    case "traites":
      return `aujourd'hui · ${counts.traites} sur la période`;
    case "tous":
      return "Circulation";
  }
}

interface Props {
  counts: MailroomCounts;
  view: MailroomView;
  onChange: (view: MailroomView) => void;
}

/**
 * Compteurs-onglets : chaque carte est un compteur ET l'onglet de sa vue.
 * « À qualifier » est mise en avant — c'est le travail qui ne se fera pas seul.
 * Les retards se lisent dans chaque carte (« dont N en retard ») plutôt que
 * dans un onglet à part.
 */
export default function MailroomCounters({ counts, view, onChange }: Props) {
  return (
    <div
      role="tablist"
      aria-label="Étapes du courrier"
      className="grid shrink-0 grid-cols-2 gap-2 border-b px-4 py-2.5 sm:grid-cols-3 md:px-5 xl:grid-cols-[1.3fr_repeat(5,minmax(0,1fr))]"
    >
      {MAILROOM_VIEW_ORDER.map((key) => {
        const Icon = ICONS[key];
        const on = view === key;
        const hero = key === "aq";
        const n = key === "traites" ? counts.traitesToday : counts[key];
        const late = key === "traites" ? 0 : counts.late[key];
        const alarm = (late > 0 && "destructive") || (key === "retour" && n > 0 && "warning") || null;
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(key)}
            className={cn(
              "flex min-w-0 flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left transition-shadow hover:shadow-airbnb",
              hero ? "border-warning/50 bg-secondary/25" : "bg-card",
              on && "border-primary ring-1 ring-primary",
            )}
          >
            <span
              className={cn(
                "flex max-w-full items-center gap-1.5 truncate text-xs font-semibold",
                hero ? "text-secondary-foreground" : alarm === "warning" ? "text-warning" : "text-muted-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              {MAILROOM_VIEWS[key].label}
            </span>
            <span
              className={cn(
                "font-bold leading-tight tabular-nums",
                hero ? "text-2xl" : "text-xl",
                alarm === "warning" ? "text-warning" : "text-foreground",
              )}
            >
              {n.toLocaleString("fr-FR")}
            </span>
            {late > 0 ? (
              <span className="flex max-w-full items-center gap-1 truncate text-[11.5px] font-semibold text-destructive">
                <ClockAlert className="h-3 w-3 shrink-0" />
                dont {late.toLocaleString("fr-FR")} en retard
              </span>
            ) : (
              <span className="max-w-full truncate text-[11.5px] text-muted-foreground">{hint(key, counts)}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
