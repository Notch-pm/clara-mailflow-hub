import { useEffect, useMemo, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { Check, Loader2, Signature } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ParapheurDetail } from "@/components/parapheur/ParapheurDetail";
import { useAuth } from "@/contexts/AuthContext";
import { useParapheur, useParapheurBulk, type ParapheurRow } from "@/hooks/useParapheur";
import { canAccessParapheur } from "@/lib/permissions";
import {
  LATE_AFTER_DAYS,
  PARAPHEUR_TAB_LABELS,
  nextSelection,
  parapheurTabs,
  shortWaitLabel,
  type ParapheurTab,
  type VisaScope,
} from "@/lib/parapheur";
import { cn } from "@/lib/utils";

const EMPTY_MESSAGES: Record<ParapheurTab, string> = {
  visa: "Aucune réponse en attente de votre visa.",
  signature: "Aucune réponse en attente de votre signature.",
  done: "Vous n'avez rien visé ni signé ce mois-ci.",
};

function handledLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Aujourd'hui";
  if (date.toDateString() === yesterday.toDateString()) return "Hier";
  return date.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n > 1 ? "s" : ""}`;
}

/**
 * Parapheur : la file de qui vise ou signe les réponses, sur grand écran.
 * Liste à gauche (les miennes d'abord, puis les plus anciennes), relecture et
 * action à droite ; une action faite, la suivante s'ouvre.
 */
export default function Parapheur() {
  const { membership } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [scope, setScope] = useState<VisaScope>("mine");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [confirmBulk, setConfirmBulk] = useState(false);

  const tabs = useMemo(() => parapheurTabs(membership), [membership]);
  const requested = searchParams.get("onglet") as ParapheurTab | null;
  const tab: ParapheurTab = requested && tabs.includes(requested) ? requested : tabs[0];
  const isQueue = tab !== "done";

  const { rows, isLoading } = useParapheur(scope);
  const bulk = useParapheurBulk();
  const list = rows[tab];
  const ids = useMemo(() => list.map((r) => r.replyId), [list]);
  const currentId = selectedId && ids.includes(selectedId) ? selectedId : (ids[0] ?? null);
  const checkedIds = useMemo(() => ids.filter((id) => checked.has(id)), [ids, checked]);

  function switchTab(next: ParapheurTab) {
    setSearchParams(next === tabs[0] ? {} : { onglet: next }, { replace: true });
    setSelectedId(null);
    setChecked(new Set());
  }

  // ↑ / ↓ parcourent la liste, sauf pendant la saisie d'un commentaire.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=true], [role=dialog], [role=alertdialog]")) return;
      if (ids.length === 0) return;
      e.preventDefault();
      const index = Math.max(0, currentId ? ids.indexOf(currentId) : 0);
      const next = e.key === "ArrowDown" ? Math.min(ids.length - 1, index + 1) : Math.max(0, index - 1);
      setSelectedId(ids[next]);
      document.getElementById(`parapheur-row-${ids[next]}`)?.scrollIntoView({ block: "nearest" });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ids, currentId]);

  if (!canAccessParapheur(membership)) return <Navigate to="/" replace />;

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function runBulk() {
    if (tab === "done") return;
    const replyIds = checkedIds;
    bulk.mutate(
      { tab, replyIds },
      {
        onSuccess: ({ done, failed }) => {
          setChecked(new Set());
          setSelectedId(nextSelection(ids, currentId, done));
          const verb = tab === "visa" ? "visée" : "signée";
          if (done.length > 0) {
            toast.success(`${plural(done.length, "réponse")} ${verb}${done.length > 1 ? "s" : ""}`, {
              description: tab === "visa" ? "Elles passent à l'étape suivante de leur workflow." : "Elles passent à l'étape suivante : l'envoi.",
            });
          }
          if (failed.length > 0) {
            toast.error(`${plural(failed.length, "réponse")} non traitée${failed.length > 1 ? "s" : ""}`, {
              description: failed[0].message,
            });
          }
        },
        onSettled: () => setConfirmBulk(false),
      },
    );
  }

  const footer = !isQueue
    ? `${plural(list.length, "réponse")} traitée${list.length > 1 ? "s" : ""} ce mois-ci`
    : `${plural(list.length, "réponse")} · les vôtres d'abord, puis les plus anciennes`;

  return (
    <div data-list-page="fill" className="flex h-full min-h-0 flex-col bg-card">
      <div className="flex min-h-14 shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b px-5 py-2.5">
        <Signature className="h-[18px] w-[18px] text-warning" aria-hidden="true" />
        <h1 className="whitespace-nowrap text-[17px] font-bold tracking-tight">Parapheur</h1>
        <div role="tablist" aria-label="Files du parapheur" className="ml-2 flex h-9 rounded-full bg-muted p-[3px]">
          {tabs.map((t) => {
            const on = t === tab;
            const count = t === "done" ? null : rows[t].length;
            return (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => switchTab(t)}
                className={cn(
                  "inline-flex h-[30px] shrink-0 items-center gap-[7px] whitespace-nowrap rounded-full px-3 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  on ? "bg-card font-bold text-foreground shadow-sm" : "font-semibold text-muted-foreground hover:text-foreground",
                )}
              >
                {PARAPHEUR_TAB_LABELS[t]}
                {count != null && !isLoading[t] && (
                  <span
                    className={cn(
                      "grid h-[18px] min-w-5 place-items-center rounded-full px-1.5 text-[11px] font-extrabold tabular-nums",
                      on ? "bg-secondary text-secondary-foreground" : "bg-border text-muted-foreground",
                    )}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className="flex-1" />
        {tab === "visa" && (
          <div role="group" aria-label="Périmètre" className="flex h-9 rounded-full border p-[3px]">
            {(
              [
                ["mine", "Mes courriers"],
                ["all", "Toute l'organisation"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={scope === value}
                onClick={() => {
                  setScope(value);
                  setSelectedId(null);
                }}
                className={cn(
                  "h-7 whitespace-nowrap rounded-full px-3 text-[13px] font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  scope === value && "bg-muted",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,40%)_minmax(0,1fr)] md:grid-cols-[minmax(340px,42%)_minmax(0,1fr)] md:grid-rows-1">
        <section aria-label={PARAPHEUR_TAB_LABELS[tab]} className="flex min-h-0 flex-col border-b md:border-b-0 md:border-r">
          {isQueue && checkedIds.length > 0 && (
            <div className="flex shrink-0 items-center gap-2.5 border-b bg-primary/5 py-2 pl-4 pr-3">
              <span className="text-[13px] font-bold">
                {plural(checkedIds.length, "sélectionnée")}
              </span>
              <button
                type="button"
                onClick={() => setChecked(new Set())}
                className="p-1 text-[13px] text-muted-foreground hover:text-foreground"
              >
                Désélectionner
              </button>
              <div className="flex-1" />
              <Button
                type="button"
                size="sm"
                disabled={bulk.isPending}
                onClick={() => setConfirmBulk(true)}
                className="h-[34px] rounded-full font-bold"
              >
                <Check className="h-[15px] w-[15px]" aria-hidden="true" />
                {tab === "visa" ? "Viser la sélection" : "Signer la sélection"}
              </Button>
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-auto">
            {isLoading[tab] ? (
              <div className="grid place-items-center py-16 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" aria-label="Chargement" />
              </div>
            ) : list.length === 0 ? (
              <div className="flex flex-col items-center gap-2.5 px-6 py-16 text-center text-sm text-muted-foreground">
                <div className="grid h-11 w-11 place-items-center rounded-full bg-primary/10 text-primary">
                  <Check className="h-[22px] w-[22px]" aria-hidden="true" />
                </div>
                <span>{EMPTY_MESSAGES[tab]}</span>
              </div>
            ) : (
              <ul>
                {list.map((row) => (
                  <ParapheurListRow
                    key={row.replyId}
                    row={row}
                    selected={row.replyId === currentId}
                    checkable={isQueue}
                    checked={checked.has(row.replyId)}
                    onSelect={() => setSelectedId(row.replyId)}
                    onToggle={() => toggle(row.replyId)}
                  />
                ))}
              </ul>
            )}
          </div>

          <div className="flex min-h-11 shrink-0 items-center gap-3.5 border-t px-4 text-[12.5px] text-muted-foreground">
            <span>{footer}</span>
            <div className="flex-1" />
            <span className="hidden items-center gap-1.5 md:inline-flex">
              <kbd className="rounded-[5px] border bg-muted px-[5px] text-[11px] font-bold">↑</kbd>
              <kbd className="rounded-[5px] border bg-muted px-[5px] text-[11px] font-bold">↓</kbd>
              naviguer
            </span>
          </div>
        </section>

        <section aria-label="Relecture" className="flex min-h-0 min-w-0 flex-col bg-background">
          {currentId ? (
            <ParapheurDetail
              key={currentId}
              replyId={currentId}
              tab={tab}
              onDone={() => setSelectedId(nextSelection(ids, currentId, [currentId]))}
            />
          ) : (
            <div className="grid flex-1 place-items-center p-6 text-center text-sm text-muted-foreground">
              Sélectionnez une réponse pour la relire.
            </div>
          )}
        </section>
      </div>

      <AlertDialog open={confirmBulk} onOpenChange={(open) => !bulk.isPending && setConfirmBulk(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {tab === "visa"
                ? `Viser ${plural(checkedIds.length, "réponse")} ?`
                : `Signer ${plural(checkedIds.length, "réponse")} ?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {tab === "visa"
                ? "Votre visa sera consigné à votre nom sur chacune, puis elles passeront à l'étape suivante de leur workflow."
                : "Votre signature sera apposée sur chacune, puis elles passeront à l'étape suivante. Une signature ne se reprend pas."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulk.isPending}>Annuler</AlertDialogCancel>
            <AlertDialogAction
              disabled={bulk.isPending}
              onClick={(e) => {
                // Le dialogue reste ouvert pendant le traitement.
                e.preventDefault();
                runBulk();
              }}
            >
              {bulk.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {tab === "visa" ? "Viser" : "Signer"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ParapheurListRow({
  row,
  selected,
  checkable,
  checked,
  onSelect,
  onToggle,
}: {
  row: ParapheurRow;
  selected: boolean;
  checkable: boolean;
  checked: boolean;
  onSelect: () => void;
  onToggle: () => void;
}) {
  const late = row.waitingDays != null && row.waitingDays >= LATE_AFTER_DAYS;
  const origin = [row.senderName, row.service].filter(Boolean).join(" · ");
  return (
    <li
      id={`parapheur-row-${row.replyId}`}
      className={cn(
        "flex cursor-pointer items-start gap-3 border-b px-4 py-3.5 transition-colors hover:bg-muted",
        selected && "bg-primary/5 shadow-[inset_3px_0_0_hsl(var(--primary))]",
      )}
      onClick={onSelect}
    >
      {checkable && (
        <Checkbox
          checked={checked}
          onCheckedChange={onToggle}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Sélectionner « ${row.title} »`}
          className="mt-0.5"
        />
      )}
      <button
        type="button"
        aria-current={selected ? "true" : undefined}
        onClick={onSelect}
        className="flex min-w-0 flex-1 flex-col gap-1 text-left focus-visible:outline-none"
      >
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-bold">{row.title}</span>
          <span
            className={cn(
              "shrink-0 rounded-full px-2 py-0.5 text-xs font-bold tabular-nums",
              row.handledAt
                ? "bg-primary/10 text-primary"
                : late
                  ? "bg-secondary/45 text-secondary-foreground"
                  : "bg-muted text-muted-foreground",
            )}
          >
            {row.handledAt ? handledLabel(row.handledAt) : shortWaitLabel(row.waitingDays ?? 0)}
          </span>
        </span>
        {origin && <span className="truncate text-[12.5px] text-muted-foreground">{origin}</span>}
        <span className="mt-0.5 flex flex-wrap items-center gap-2">
          {row.chrono && (
            <span className="whitespace-nowrap font-mono text-[11.5px] text-muted-foreground">{row.chrono}</span>
          )}
          <span className="whitespace-nowrap rounded-full border px-2 py-px text-[11.5px] font-semibold">{row.step}</span>
          {row.designatedToOther && (
            <span className="text-[11.5px] text-muted-foreground">
              Un autre viseur est désigné · vous pouvez viser à sa place
            </span>
          )}
        </span>
      </button>
    </li>
  );
}
