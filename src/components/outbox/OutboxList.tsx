import { useEffect, useRef } from "react";
import { ChevronRight } from "lucide-react";
import { OutboundKindBadge } from "@/components/courier/outbound/OutboundKindBadge";
import { LIST_HEADER_SURFACE } from "@/components/list/ListCells";
import { ListFooter, ListMessage } from "@/components/list/ListPage";
import { ListScrollArea } from "@/components/list/ListScrollArea";
import { shortDate } from "@/components/mailroom/mailroomDisplay";
import { channelLabels } from "@/hooks/useCourierWorkspace";
import { OUTBOX_VIEWS, outboxTitle, type OutboxItem, type OutboxView } from "@/lib/outbox";
import { LATE_AFTER_DAYS } from "@/lib/parapheur";
import { cn } from "@/lib/utils";
import type { CourierChannel } from "@/types/courier";

/** Gabarit partagé par l'en-tête et les lignes ; sous `md`, les deux colonnes passent sous l'objet. */
const ROW_GRID =
  "grid grid-cols-[minmax(0,1fr)_16px] items-center gap-4 md:grid-cols-[minmax(0,1fr)_190px_200px_16px] xl:grid-cols-[minmax(0,1fr)_210px_220px_16px]";

/** « Signature · depuis 3 j », « Envoyé le 04/10 » */
function statusText(item: OutboxItem): string {
  if (item.stage === "envoyes") {
    if (item.row.sent_email_at) return `Envoyé par courriel le ${shortDate(item.row.sent_email_at)}`;
    if (item.row.posted_at) return `Posté le ${shortDate(item.row.posted_at)}`;
    return item.sentOn ? `Clôturé · ${shortDate(item.sentOn)}` : "Clôturé";
  }
  const state = item.row.state_name ?? "Sans état";
  return `${state} · ${item.waitingDays <= 0 ? "aujourd'hui" : `depuis ${item.waitingDays} j`}`;
}

interface Props {
  view: OutboxView;
  items: OutboxItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  orgName: (id: string | null) => string | null;
  isLoading: boolean;
  filtered: boolean;
}

export default function OutboxList({ view, items, selectedId, onSelect, orgName, isLoading, filtered }: Props) {
  const def = OUTBOX_VIEWS[view];
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selectedId) return;
    listRef.current?.querySelector(`[data-courier-id="${selectedId}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selectedId, view]);

  return (
    <section aria-label={def.label} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b px-4 md:px-5">
        <h2 className="shrink-0 text-sm font-bold">{def.label}</h2>
        <span className="hidden min-w-0 truncate text-[13px] text-muted-foreground sm:inline">{def.description}</span>
      </div>

      <div
        className={cn(
          ROW_GRID,
          LIST_HEADER_SURFACE,
          "hidden h-[38px] shrink-0 border-b border-l-[3px] border-l-transparent px-4 text-xs font-semibold text-muted-foreground md:grid md:pl-5",
        )}
      >
        <span>Courrier</span>
        <span>Organisation</span>
        <span>{view === "envoyes" ? "Envoi" : "État et attente"}</span>
        <span />
      </div>

      <ListScrollArea resetKey={view}>
        <div ref={listRef}>
          {isLoading ? (
            <ListMessage>Chargement…</ListMessage>
          ) : items.length === 0 ? (
            <ListMessage>{filtered ? "Aucun courrier ne correspond à ces filtres." : def.empty}</ListMessage>
          ) : (
            items.map((item) => {
              const { row } = item;
              const selected = row.id === selectedId;
              const late = item.stage !== "envoyes" && item.waitingDays >= LATE_AFTER_DAYS;
              const status = statusText(item);
              const chrono = row.chrono ?? row.parent_chrono;
              return (
                <button
                  key={row.id}
                  data-courier-id={row.id}
                  type="button"
                  onClick={() => onSelect(row.id)}
                  aria-current={selected}
                  className={cn(
                    ROW_GRID,
                    "min-h-12 w-full border-b border-l-[3px] border-b-border/70 px-4 py-1.5 text-left transition-colors group-data-[density=compact]/list:min-h-9 group-data-[density=compact]/list:py-1 md:pl-5",
                    selected ? "border-l-primary bg-primary/[0.06]" : "border-l-transparent hover:bg-muted/55",
                  )}
                >
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="flex min-w-0 items-center gap-2">
                      <OutboundKindBadge kind={item.kind} />
                      <span className="truncate text-[13.5px] font-semibold text-foreground">{outboxTitle(item)}</span>
                    </span>
                    <span className="flex min-w-0 items-center gap-1.5 truncate text-xs text-muted-foreground group-data-[density=compact]/list:hidden">
                      {chrono && (
                        <>
                          <span className="font-semibold tabular-nums text-foreground/80">{chrono}</span>
                          <span aria-hidden="true">·</span>
                        </>
                      )}
                      <span>{channelLabels[row.channel as CourierChannel] ?? row.channel}</span>
                      {row.recipient_name && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="truncate">À {row.recipient_name}</span>
                        </>
                      )}
                      {/* Sous `md`, pas de colonnes : l'état passe ici. */}
                      <span className={cn("truncate md:hidden", late && "font-semibold text-warning")}>· {status}</span>
                    </span>
                  </span>
                  <span className="hidden min-w-0 truncate text-[13px] md:block">
                    {orgName(row.socle_organization_id) ?? <span className="text-muted-foreground">—</span>}
                  </span>
                  <span
                    className={cn(
                      "hidden min-w-0 truncate text-xs font-semibold md:block",
                      item.stage === "envoyes" ? "text-primary" : late ? "text-warning" : "text-muted-foreground",
                    )}
                  >
                    {status}
                  </span>
                  <ChevronRight className={cn("h-4 w-4", selected ? "text-primary" : "text-muted-foreground/60")} />
                </button>
              );
            })
          )}
        </div>
      </ListScrollArea>

      <ListFooter>
        <span>
          {items.length.toLocaleString("fr-FR")} courrier{items.length > 1 ? "s" : ""} · {def.label.toLowerCase()}
        </span>
      </ListFooter>
    </section>
  );
}
