import { CircleCheck, ClockAlert, List, Route, Sparkles, TriangleAlert, Undo2, type LucideIcon } from "lucide-react";
import { CounterTabs } from "@/components/list/CounterTabs";
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
    <CounterTabs
      ariaLabel="Étapes du courrier"
      className="grid-cols-2 sm:grid-cols-3 xl:grid-cols-[1.3fr_repeat(5,minmax(0,1fr))]"
      value={view}
      onChange={onChange}
      tabs={MAILROOM_VIEW_ORDER.map((key) => {
        const n = key === "traites" ? counts.traitesToday : counts[key];
        const late = key === "traites" ? 0 : counts.late[key];
        return {
          key,
          label: MAILROOM_VIEWS[key].label,
          icon: ICONS[key],
          count: n,
          hero: key === "aq",
          // Un retard l'emporte : l'alerte est alors dans la ligne du dessous.
          warn: late === 0 && key === "retour" && n > 0,
          subTone: late > 0 ? "destructive" : "muted",
          sub:
            late > 0 ? (
              <>
                <ClockAlert className="h-3 w-3 shrink-0" />
                dont {late.toLocaleString("fr-FR")} en retard
              </>
            ) : (
              hint(key, counts)
            ),
        };
      })}
    />
  );
}
