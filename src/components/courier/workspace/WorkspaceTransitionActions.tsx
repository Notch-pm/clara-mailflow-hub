import type { ComponentProps } from "react";
import { ArrowLeft, ArrowRightLeft, BellRing, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { categoryTone } from "@/lib/workflow-category";
import type { WorkflowState, WorkflowTransition } from "@/types/courier";
import AdvanceBlockedButton from "../AdvanceBlockedButton";

export type WorkspaceTransition = WorkflowTransition & { to_state: WorkflowState };

interface Props {
  previous?: WorkspaceTransition;
  next?: WorkspaceTransition;
  others: WorkspaceTransition[];
  pending: boolean;
  onTransition: (toStateId: string) => void;
  canRemindService: boolean;
  remindPending: boolean;
  onRemind: () => void;
  canReassign: boolean;
  onReassign: () => void;
  /** Pourquoi « Suivant » est grisé quand il n'y a pas de transition nominale. */
  blockedReason: ComponentProps<typeof AdvanceBlockedButton>["reason"];
}

/**
 * Actions d'avancement de l'en-tête. Sous sm elles s'empilent sur toute la
 * largeur : `shrink-0` sur la rangée et `whitespace-nowrap` sur les boutons
 * rendaient un libellé long — « Transmettre au service instructeur » —
 * irréductible, et la page entière s'élargissait derrière lui.
 */
export function WorkspaceTransitionActions({
  previous,
  next,
  others,
  pending,
  onTransition,
  canRemindService,
  remindPending,
  onRemind,
  canReassign,
  onReassign,
  blockedReason,
}: Props) {
  const hasOtherActions = others.length > 0 || canRemindService || canReassign;
  return (
    <div className="flex w-full shrink-0 flex-col gap-2.5 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
      {previous && (
        <Button
          variant="outline"
          onClick={() => onTransition(previous.to_state.id)}
          disabled={pending}
          className="h-10 w-full min-w-0 gap-2 sm:w-auto"
        >
          <ArrowLeft className="h-4 w-4 shrink-0" />
          <span className="truncate">{previous.name ?? previous.to_state?.name ?? "Précédent"}</span>
        </Button>
      )}
      {hasOtherActions && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="h-10 w-full gap-1.5 sm:w-auto" disabled={pending}>
              Autres actions
              <ChevronDown className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {others.map((t) => (
              <DropdownMenuItem key={t.id} onClick={() => onTransition(t.to_state.id)}>
                <span className="flex items-center gap-2">
                  <span className={cn("h-2 w-2 rounded-full", categoryTone(t.to_state?.category).dot)} />
                  {t.name ?? t.to_state?.name ?? "Transition"}
                </span>
              </DropdownMenuItem>
            ))}
            {others.length > 0 && (canRemindService || canReassign) && <DropdownMenuSeparator />}
            {canRemindService && (
              <DropdownMenuItem disabled={remindPending} onClick={onRemind}>
                <span className="flex items-center gap-2">
                  <BellRing className="h-4 w-4 text-muted-foreground" />
                  Relancer le service
                </span>
              </DropdownMenuItem>
            )}
            {canReassign && (
              <DropdownMenuItem onSelect={onReassign}>
                <span className="flex items-center gap-2">
                  <ArrowRightLeft className="h-4 w-4 text-muted-foreground" />
                  Réaffecter…
                </span>
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {next && (
        <Button
          onClick={() => onTransition(next.to_state.id)}
          disabled={pending}
          className="h-10 w-full min-w-0 gap-2 font-bold shadow-airbnb sm:w-auto"
        >
          <span className={cn("h-2 w-2 shrink-0 rounded-full", categoryTone(next.to_state?.category).dot)} />
          <span className="truncate">{next.name ?? next.to_state?.name ?? "Suivant"}</span>
        </Button>
      )}
      {/* Sans transition nominale, cet écran n'affichait RIEN : l'agent
          n'avait aucun moyen de savoir s'il manquait un droit, un état, ou
          une transition dans le workflow. Un bouton grisé qui dit pourquoi
          vaut mieux qu'un silence — c'est aussi ce que fait la boîte aux
          lettres, les deux écrans ne doivent pas raconter deux histoires. */}
      {!next && (
        <AdvanceBlockedButton
          reason={blockedReason}
          wrapperClassName="w-full min-w-0 sm:w-auto"
          className="h-10 w-full min-w-0 gap-2 font-bold sm:w-auto"
        >
          <span className="h-2 w-2 shrink-0 rounded-full bg-muted-foreground" />
          <span className="truncate">Suivant</span>
        </AdvanceBlockedButton>
      )}
    </div>
  );
}
