import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Cadenas d'un courrier confidentiel. Seul (`compact`) devant un objet dans les
 * listes ; avec son libellé ailleurs. Icône ET texte accessible : la couleur
 * seule ne porte pas l'information.
 */
export function ConfidentialBadge({ compact = false, className }: { compact?: boolean; className?: string }) {
  if (compact) {
    return (
      <Lock
        className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground", className)}
        aria-label="Courrier confidentiel"
        role="img"
      />
    );
  }
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 self-start whitespace-nowrap rounded-full bg-foreground/10 px-2 py-px text-[11.5px] font-bold text-foreground",
        className,
      )}
    >
      <Lock className="h-3 w-3" aria-hidden="true" />
      Confidentiel
    </span>
  );
}

/** L'objet d'une ligne illisible : « [courrier confidentiel] », en retrait. */
export function MaskedSubject({ children }: { children: React.ReactNode }) {
  return <span className="italic text-muted-foreground">{children}</span>;
}
