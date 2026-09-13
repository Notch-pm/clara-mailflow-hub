import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Bouton d'avancement grisé, portant en infobulle la raison du blocage
 * (`advanceBlockedReason`).
 *
 * ⚠️ **Un `title` HTML ne fonctionne pas ici.** Le bouton shadcn porte
 * `disabled:pointer-events-none` — et, classe ou pas, un contrôle désactivé ne
 * reçoit aucun événement de souris dans Chrome. Une infobulle native posée sur
 * lui est donc invisible : le message est calculé, personne ne le lit. C'est
 * exactement le piège dans lequel la première version de ce correctif est
 * tombée (2026-09-13).
 *
 * L'infobulle est donc portée par un `span` intercalé, seul élément à recevoir
 * le survol. Il est focalisable (`tabIndex`) pour que la raison soit lisible au
 * clavier aussi — sans quoi le blocage resterait muet pour qui n'a pas de
 * souris.
 */
export default function AdvanceBlockedButton({
  reason,
  className,
  wrapperClassName,
  children,
}: {
  /** Phrase rendue par `advanceBlockedReason`. */
  reason: string;
  /** Classes du bouton lui-même. */
  className?: string;
  /** Classes du `span` porteur — c'est lui qui prend la place dans la rangée. */
  wrapperClassName?: string;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className={cn("inline-flex", wrapperClassName)}>
          <Button className={className} disabled>
            {children}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-pretty">{reason}</TooltipContent>
    </Tooltip>
  );
}
