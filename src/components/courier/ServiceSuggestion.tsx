import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRightLeft, Check, Loader2, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { serviceSuggestionKind } from "@/lib/service-suggestion";
import { getAnalysis } from "@/services/courierAnalysisService";

interface Props {
  courierId: string;
  currentOrgId: string | null;
  isInitialState: boolean;
  readOnly?: boolean;
  /** Toutes les organisations du tenant — pour afficher le nom à jour. */
  orgs: readonly { id: string; name: string }[];
  /** Organisations que l'agent peut choisir à l'affectation (`availableServices`). */
  assignableIds: readonly string[];
  /** Organisations proposées au transfert (`assignableOrgs` hors courante). */
  transferableIds: readonly string[];
  /** Affectation directe (état initial) : `serviceMutation.mutate`. */
  onAssign: (orgId: string) => void;
  /** Transfert : ouvre la confirmation existante, n'agit pas. */
  onTransfer: (orgId: string) => void;
  busy?: boolean;
  /** `inline` (panneau de tri) : rien quand l'IA confirme le choix en place. */
  variant?: "card" | "inline";
}

/**
 * Service instructeur proposé par l'analyse IA, avec sa raison. Une
 * proposition : l'agent l'applique d'un clic, ou l'écarte. Lit l'analyse sous
 * la même clé que l'onglet Contenu (cache partagé).
 */
export default function ServiceSuggestion({
  courierId,
  currentOrgId,
  isInitialState,
  readOnly = false,
  orgs,
  assignableIds,
  transferableIds,
  onAssign,
  onTransfer,
  busy = false,
  variant = "card",
}: Props) {
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const { data: analysis } = useQuery({
    queryKey: ["courier-analysis", courierId],
    queryFn: () => getAnalysis(courierId),
    enabled: !!courierId,
  });

  const suggestedId = analysis?.suggested_socle_organization_id ?? null;
  const kind = serviceSuggestionKind({
    suggestedId,
    currentId: currentOrgId,
    isInitialState,
    assignableIds,
    transferableIds,
  });
  if (kind === "none" || suggestedId === dismissedId) return null;
  if (kind === "confirm" && variant === "inline") return null;

  const name =
    orgs.find((o) => o.id === suggestedId)?.name ?? analysis?.suggested_service_name ?? "Organisation";
  const reason = analysis?.suggested_service_reason;

  if (kind === "confirm") {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Check className="h-3.5 w-3.5 shrink-0 text-success" aria-hidden="true" />
        L'analyse confirme l'organisation désignée.
      </p>
    );
  }

  const title = kind === "assign" ? "Service proposé" : "L'analyse propose plutôt";
  const action =
    kind === "transfer"
      ? { label: `Transférer à ${name}…`, icon: ArrowRightLeft, run: () => onTransfer(suggestedId!) }
      : { label: `Affecter à ${name}`, icon: Check, run: () => onAssign(suggestedId!) };

  return (
    <div
      className={cn(
        "rounded-md border border-primary/20 bg-primary/5 p-2.5",
        variant === "inline" && "mt-2",
      )}
      aria-label="Organisation proposée par l'analyse"
    >
      <div className="flex items-start gap-2">
        <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="text-xs text-muted-foreground">{title}</p>
          <p className="text-sm font-semibold [overflow-wrap:anywhere]">{name}</p>
          {reason && <p className="text-xs text-muted-foreground">{reason}</p>}
          {kind === "unavailable" && (
            <p className="text-xs italic text-muted-foreground">
              Vous ne pouvez pas confier ce courrier à cette organisation d'ici.
            </p>
          )}
        </div>
        <button
          type="button"
          className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Écarter la proposition"
          title="Écarter la proposition"
          onClick={() => setDismissedId(suggestedId)}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {kind !== "unavailable" && !readOnly && (
        <div className="mt-2 flex justify-end">
          <Button size="sm" className="h-7 text-xs" disabled={busy} onClick={action.run}>
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <action.icon className="h-3 w-3" />}
            {action.label}
          </Button>
        </div>
      )}
    </div>
  );
}
