import type { ReactNode } from "react";
import { ArrowLeft, ChevronDown, PenLine, Printer, Send, Stamp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ReplyWorkflowData } from "@/services/courierReplyService";
import { isFreeExitFromVisa } from "@/lib/reply-visa";
import { cn } from "@/lib/utils";
import { gestureLabel, type NextGesture } from "./nextGesture";

type WorkflowState = ReplyWorkflowData["states"][number];
type WorkflowTransition = ReplyWorkflowData["transitions"][number];
export interface TransitionEntry {
  transition: WorkflowTransition;
  target: WorkflowState;
}
export type TransitionTarget = Pick<WorkflowState, "id" | "name" | "category" | "is_final">;

/** Un bouton grisé dit pourquoi, au survol. */
export function MaybeTooltip({ reason, children }: { reason: string | null; children: ReactNode }) {
  if (!reason) return <>{children}</>;
  return (
    <Tooltip>
      <TooltipTrigger asChild><span tabIndex={0} className="inline-flex">{children}</span></TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  );
}

function stateDot(category: string | null) {
  return cn(
    "h-2 w-2 rounded-full shrink-0",
    category === "pending" && "bg-amber-500",
    category === "processing" && "bg-blue-500",
    category === "processed" && "bg-emerald-500",
    category === "archived" && "bg-slate-400",
    !category && "bg-gray-300",
  );
}

const GESTURE_ICON: Record<Exclude<NextGesture, null>, ReactNode> = {
  post: <Printer className="h-3.5 w-3.5" />,
  visa: <Stamp className="h-3.5 w-3.5" />,
  sign: <PenLine className="h-3.5 w-3.5" />,
  send: <Send className="h-3.5 w-3.5" />,
};

interface Props {
  entries: TransitionEntry[];
  isFinal: boolean;
  /**
   * Étape de visa pas encore visée : seules les sorties que la base laisse
   * passer sans visa (retour, abandon, renvoi pour correction) sont proposées
   * — les autres finiraient sur un refus serveur. `null` hors de ce cas.
   */
  visaGate: { visaStateId: string; transitions: WorkflowTransition[] } | null;
  /** Le geste que porte la transition nominale, et ce qui la bloque. */
  gesture: NextGesture;
  nextBlocker: string | null;
  sending: boolean;
  busy: boolean;
  readOnly: boolean;
  /** Transition simple (retour, autres actions, suivante sans geste). */
  onRun: (target: TransitionTarget) => void;
  /** Transition nominale portant un geste (poster, viser, signer, envoyer). */
  onGesture: () => void;
}

/** Retour, « Autres actions » et transition nominale d'un sortant. */
export function OutboundTransitionsBar({
  entries,
  isFinal,
  visaGate,
  gesture,
  nextBlocker,
  sending,
  busy,
  readOnly,
  onRun,
  onGesture,
}: Props) {
  if (entries.length === 0) {
    return !isFinal ? <span className="text-xs text-muted-foreground italic">Aucune transition définie.</span> : null;
  }

  const nextEntry = entries.find(({ transition }) => transition.kind === "next");
  const prevEntry = entries.find(({ transition }) => transition.kind === "previous");
  const nominalIds = new Set([nextEntry?.transition.id, prevEntry?.transition.id].filter(Boolean));
  const others = entries.filter(
    ({ transition, target }) =>
      !nominalIds.has(transition.id) &&
      (!visaGate ||
        isFreeExitFromVisa({ kind: (transition.kind ?? null) as "next" | "previous" | null, target }, visaGate)),
  );

  const run = (target: WorkflowState) =>
    onRun({ id: target.id, name: target.name, category: target.category, is_final: target.is_final });

  return (
    <div className="flex items-center gap-2">
      {prevEntry && (
        <Button size="sm" variant="outline" className="h-8 gap-1.5" disabled={busy || readOnly} onClick={() => run(prevEntry.target)}>
          <ArrowLeft className="h-3.5 w-3.5" />
          {prevEntry.transition.name || prevEntry.target.name}
        </Button>
      )}
      {nextEntry && (
        <MaybeTooltip reason={nextBlocker}>
          <Button
            size="sm"
            className="h-8 gap-1.5"
            disabled={busy || readOnly || !!nextBlocker}
            onClick={() => (gesture ? onGesture() : run(nextEntry.target))}
          >
            {gesture ? GESTURE_ICON[gesture] : <span className={stateDot(nextEntry.target.category)} />}
            {gestureLabel(gesture, nextEntry.transition.name || nextEntry.target.name, sending)}
          </Button>
        </MaybeTooltip>
      )}
      {others.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" className="h-8 gap-1.5" disabled={busy || readOnly}>
              Autres actions
              <ChevronDown className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {others.map(({ transition: t, target }) => (
              <DropdownMenuItem key={t.id} onClick={() => run(target)}>
                <div className="flex items-center gap-2">
                  <span className={stateDot(target.category)} />
                  <span>{t.name || target.name}</span>
                </div>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
