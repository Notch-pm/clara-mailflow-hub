import { Reply, Send } from "lucide-react";
import { OUTBOUND_KIND_DESCRIPTIONS, OUTBOUND_KIND_LABELS, type OutboundKind } from "@/lib/outbound-kind";
import { cn } from "@/lib/utils";

/**
 * « Réponse » ou « Initiative » : ce que l'on vise ou signe ne se lit pas de
 * la même façon selon qu'on répond à un usager ou qu'on lui écrit en premier.
 * Icône ET libellé — la couleur seule ne porte pas l'information.
 */
export function OutboundKindBadge({ kind, size = "sm" }: { kind: OutboundKind; size?: "sm" | "lg" }) {
  const Icon = kind === "reply" ? Reply : Send;
  return (
    <span
      title={OUTBOUND_KIND_DESCRIPTIONS[kind]}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 self-start whitespace-nowrap rounded-full font-bold",
        size === "lg" ? "h-7 px-3 text-[13px]" : "px-2 py-px text-[11.5px]",
        kind === "reply" ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary",
      )}
    >
      <Icon className={size === "lg" ? "h-3.5 w-3.5" : "h-3 w-3"} aria-hidden="true" />
      {OUTBOUND_KIND_LABELS[kind]}
      <span className="sr-only"> — {OUTBOUND_KIND_DESCRIPTIONS[kind]}</span>
    </span>
  );
}
