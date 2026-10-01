import { ArrowDownWideNarrow, CheckCheck, ChevronRight, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LIST_HEADER_SURFACE } from "@/components/list/ListCells";
import { ListFooter, ListMessage } from "@/components/list/ListPage";
import { ListScrollArea } from "@/components/list/ListScrollArea";
import { channelLabels } from "@/hooks/useCourierWorkspace";
import { cn } from "@/lib/utils";
import { MAILROOM_VIEWS, type MailroomItem, type MailroomView } from "@/lib/mailroom";
import type { CourierChannel } from "@/types/courier";
import { TONE_TEXT, serviceCell, shortDate, stageLabel, statusCell } from "./mailroomDisplay";

/** Gabarit partagé par l'en-tête et les lignes ; sous `md`, les deux colonnes passent sous l'objet. */
const ROW_GRID =
  "grid grid-cols-[minmax(0,1fr)_16px] items-center gap-4 md:grid-cols-[minmax(0,1fr)_190px_200px_16px] xl:grid-cols-[minmax(0,1fr)_210px_220px_16px]";

interface Props {
  view: MailroomView;
  items: MailroomItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  orgName: (id: string | null) => string | null;
  isLoading: boolean;
  /** Courriers en cours d'analyse (bandeau, vues « à qualifier » / « à valider »). */
  analysingCount: number;
  /** Lot « valider les propositions ≥ 90 % » — vue « à valider » seulement. */
  batchCount: number;
  batchBusy: boolean;
  onBatch: () => void;
  /** Courriers à qualifier faute d'analyse — vue « à qualifier » seulement. */
  analyzeCount: number;
  analyzeBusy: boolean;
  onAnalyze: () => void;
  filtered: boolean;
}

export default function MailroomList({
  view,
  items,
  selectedId,
  onSelect,
  orgName,
  isLoading,
  analysingCount,
  batchCount,
  batchBusy,
  onBatch,
  analyzeCount,
  analyzeBusy,
  onAnalyze,
  filtered,
}: Props) {
  const def = MAILROOM_VIEWS[view];
  const showAnalysing = analysingCount > 0 && (view === "aq" || view === "av");

  return (
    <section aria-label={def.label} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b px-4 md:px-5">
        <h2 className="shrink-0 text-[16px] font-extrabold">{def.label}</h2>
        <span className="hidden min-w-0 truncate text-sm text-muted-foreground sm:inline">{def.description}</span>
        <div className="flex-1" />
        {view === "av" && batchCount > 0 && (
          <Button variant="outline" size="sm" onClick={onBatch} disabled={batchBusy} className="gap-2 font-bold">
            {batchBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCheck className="h-4 w-4 text-primary" />}
            Valider les {batchCount} proposition{batchCount > 1 ? "s" : ""} ≥ 90 %
          </Button>
        )}
        {view === "aq" && analyzeCount > 0 && (
          <Button variant="outline" size="sm" onClick={onAnalyze} disabled={analyzeBusy} className="gap-2 font-bold">
            {analyzeBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4 text-primary" />}
            Lancer l'analyse IA ({analyzeCount} non analysé{analyzeCount > 1 ? "s" : ""})
          </Button>
        )}
        <span className="hidden items-center gap-1.5 text-[13px] font-semibold text-muted-foreground lg:flex">
          <ArrowDownWideNarrow className="h-4 w-4" />
          {def.sortLabel}
        </span>
      </div>

      {showAnalysing && (
        <div className="flex shrink-0 items-center gap-2.5 border-b bg-primary/5 px-4 py-2.5 text-[13px] md:px-5">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
          <span>
            <strong>
              {analysingCount} courrier{analysingCount > 1 ? "s" : ""} en cours d'analyse par Clara
            </strong>{" "}
            · ils rejoindront « À valider » ou « À qualifier » une fois analysés.
          </span>
        </div>
      )}

      <div
        className={cn(
          ROW_GRID,
          LIST_HEADER_SURFACE,
          "hidden h-[38px] shrink-0 border-b border-l-[3px] border-l-transparent px-4 text-xs font-semibold text-muted-foreground md:grid md:pl-5",
        )}
      >
        <span>Courrier</span>
        <span>{def.columns[0]}</span>
        <span>{def.columns[1]}</span>
        <span />
      </div>

      <ListScrollArea resetKey={view}>
        {isLoading ? (
          <ListMessage>Chargement…</ListMessage>
        ) : items.length === 0 ? (
          <ListMessage>{filtered ? "Aucun courrier ne correspond à ces filtres." : def.empty}</ListMessage>
        ) : (
          items.map((item) => {
            const { row } = item;
            const selected = row.id === selectedId;
            const stage = stageLabel(item);
            const svc = serviceCell(item, orgName);
            const status = statusCell(item);
            const SvcIcon = svc.icon;
            const StatusIcon = status.icon;
            const title = [row.sender_name, row.subject || "Sans objet"].filter(Boolean).join(" — ");
            return (
              <button
                key={row.id}
                type="button"
                onClick={() => onSelect(row.id)}
                aria-current={selected}
                className={cn(
                  ROW_GRID,
                  "w-full border-b border-l-[3px] border-b-border/70 px-4 py-3 text-left transition-colors group-data-[density=compact]/list:py-2 md:pl-5",
                  selected ? "border-l-primary bg-primary/[0.06]" : "border-l-transparent hover:bg-muted/55",
                )}
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-[14.5px] font-bold">{title}</span>
                  <span className="flex min-w-0 items-center gap-1.5 truncate text-[12.5px] text-muted-foreground">
                    <span>{channelLabels[row.channel as CourierChannel] ?? row.channel}</span>
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums">{shortDate(row.received_at ?? row.created_at)}</span>
                    <span aria-hidden="true">·</span>
                    <span className={cn("font-bold", TONE_TEXT[stage.tone])}>{stage.label}</span>
                    {/* Sous `md`, pas de colonnes : le statut passe ici. */}
                    <span className={cn("truncate md:hidden", TONE_TEXT[status.tone])}>· {status.text}</span>
                  </span>
                </span>
                <span className={cn("hidden min-w-0 items-center gap-1.5 text-[13.5px] md:flex", TONE_TEXT[svc.tone])}>
                  {SvcIcon && <SvcIcon className="h-3.5 w-3.5 shrink-0 text-primary" />}
                  <span className="truncate">{svc.text}</span>
                </span>
                <span className={cn("hidden min-w-0 items-center gap-1.5 text-[13px] font-bold md:flex", TONE_TEXT[status.tone])}>
                  {StatusIcon && <StatusIcon className={cn("h-3.5 w-3.5 shrink-0", status.spin && "animate-spin")} />}
                  <span className="truncate">{status.text}</span>
                </span>
                <ChevronRight className={cn("h-4 w-4", selected ? "text-primary" : "text-muted-foreground/60")} />
              </button>
            );
          })
        )}
      </ListScrollArea>

      <ListFooter>
        <span>
          {items.length.toLocaleString("fr-FR")} courrier{items.length > 1 ? "s" : ""} · {def.label.toLowerCase()}
        </span>
      </ListFooter>
    </section>
  );
}
