import { FilePen, List, Send, Signature, Stamp, Truck, type LucideIcon } from "lucide-react";
import { CounterTabs } from "@/components/list/CounterTabs";
import { OUTBOX_VIEW_ORDER, OUTBOX_VIEWS, type OutboxCounts, type OutboxView } from "@/lib/outbox";

const ICONS: Record<OutboxView, LucideIcon> = {
  redaction: FilePen,
  visa: Stamp,
  signature: Signature,
  envoi: Truck,
  envoyes: Send,
  tous: List,
};

const HINTS: Record<OutboxView, string> = {
  redaction: "Brouillons, à corriger",
  visa: "Visa attendu",
  signature: "Signature attendue",
  envoi: "À faire partir",
  envoyes: "Sur la période",
  tous: "Circuit complet",
};

/**
 * Compteurs-onglets des courriers sortants. « En attente de signature » est
 * mise en avant : c'est l'étape où un courrier attend le plus souvent.
 * « Prêt à l'envoi » passe en orange dès qu'un courrier y attend — plus
 * personne d'autre ne le fera partir.
 */
export default function OutboxCounters({
  counts,
  view,
  onChange,
}: {
  counts: OutboxCounts;
  view: OutboxView;
  onChange: (view: OutboxView) => void;
}) {
  return (
    <CounterTabs
      ariaLabel="Étapes des courriers sortants"
      className="grid-cols-2 sm:grid-cols-3 xl:grid-cols-[repeat(2,minmax(0,1fr))_1.3fr_repeat(3,minmax(0,1fr))]"
      value={view}
      onChange={onChange}
      tabs={OUTBOX_VIEW_ORDER.map((key) => ({
        key,
        label: OUTBOX_VIEWS[key].label,
        icon: ICONS[key],
        count: counts[key],
        hero: key === "signature",
        warn: key === "envoi" && counts.envoi > 0,
        sub: HINTS[key],
      }))}
    />
  );
}
