import { Fragment } from "react";
import { Check, ChevronRight } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { categoryTone } from "@/lib/workflow-category";
import { cn } from "@/lib/utils";
import type { WorkflowChainState } from "@/services/workflowService";

/** Au-delà, les étapes éloignées de l'état courant se replient en « … ». */
const MAX_VISIBLE = 5;

interface Props {
  chain: WorkflowChainState[];
  currentStateId: string | null | undefined;
  /** État courant, pour le cas où il n'est pas dans la chaîne nominale. */
  current: { name: string; category?: string | null } | null | undefined;
  className?: string;
}

function StatePill({ name, category }: { name: string; category?: string | null }) {
  const tone = categoryTone(category);
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 font-bold",
        tone.pill,
      )}
      aria-current="step"
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", tone.dot)} aria-hidden />
      {name}
    </span>
  );
}

function Ellipsis({ names }: { names: string[] }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="cursor-default px-0.5 text-muted-foreground" aria-label={names.join(", ")}>
          …
        </span>
      </TooltipTrigger>
      <TooltipContent>{names.join(" › ")}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Frise d'avancement du workflow, logée dans la barre du fil d'Ariane : le
 * fil dit où l'on est dans l'application, la frise où en est le courrier.
 * Les étapes franchies portent une coche, l'étape courante sa teinte de
 * catégorie, les étapes à venir restent en gris.
 */
export function WorkflowTrail({ chain, currentStateId, current, className }: Props) {
  const index = chain.findIndex((s) => s.id === currentStateId);

  // État atteint par une transition secondaire : hors de la suite nominale,
  // on n'en dessine pas la frise — l'état seul, sans position.
  if (index === -1) {
    if (!current?.name) return null;
    return (
      <div className={cn("flex items-center text-xs font-semibold", className)}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={0}>
              <StatePill name={current.name} category={current.category} />
            </span>
          </TooltipTrigger>
          <TooltipContent>Atteint par une transition secondaire, hors de la suite nominale.</TooltipContent>
        </Tooltip>
      </div>
    );
  }

  // Fenêtre autour de l'état courant : un pas en arrière, la suite devant.
  let from = 0;
  let to = chain.length - 1;
  if (chain.length > MAX_VISIBLE) {
    from = Math.max(0, index - 1);
    to = Math.min(chain.length - 1, from + MAX_VISIBLE - 2);
    from = Math.max(0, to - (MAX_VISIBLE - 2));
  }
  const hiddenBefore = chain.slice(0, from).map((s) => s.name);
  const hiddenAfter = chain.slice(to + 1).map((s) => s.name);
  const visible = chain.slice(from, to + 1);

  const sep = <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/60" aria-hidden />;

  return (
    <ol
      aria-label="Avancement du courrier"
      className={cn("flex min-w-0 flex-wrap items-center gap-1.5 text-xs font-semibold", className)}
    >
      {hiddenBefore.length > 0 && (
        <li className="flex items-center gap-1.5">
          <Ellipsis names={hiddenBefore} />
          {sep}
        </li>
      )}
      {visible.map((state, i) => {
        const pos = from + i;
        return (
          <Fragment key={state.id}>
            <li className="flex items-center gap-1.5">
              {pos < index ? (
                <span className="inline-flex items-center gap-1 whitespace-nowrap text-primary">
                  <Check className="h-3 w-3" aria-hidden />
                  {state.name}
                  <span className="sr-only">(étape franchie)</span>
                </span>
              ) : pos === index ? (
                <StatePill name={state.name} category={state.category} />
              ) : (
                <span className="whitespace-nowrap text-muted-foreground">{state.name}</span>
              )}
              {(i < visible.length - 1 || hiddenAfter.length > 0) && sep}
            </li>
          </Fragment>
        );
      })}
      {hiddenAfter.length > 0 && (
        <li className="flex items-center">
          <Ellipsis names={hiddenAfter} />
        </li>
      )}
    </ol>
  );
}
