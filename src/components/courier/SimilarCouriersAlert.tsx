import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link as RouterLink } from "react-router-dom";
import { AlertTriangle, ChevronDown, ChevronUp, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  computeSimilarCouriers,
  createRelation,
  listRelationsForCourier,
  type CourierRelationType,
} from "@/services/courierRelationService";

interface Props {
  courierId: string;
  organizationId: string;
  /** Hide the alert entirely (e.g. readOnly / not in initial state). */
  disabled?: boolean;
}

const DISMISSED_STORAGE_KEY = (courierId: string) =>
  `clara:dismissed-link-suggestions:${courierId}`;

function loadDismissed(courierId: string): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_STORAGE_KEY(courierId));
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}
function saveDismissed(courierId: string, set: Set<string>) {
  try {
    localStorage.setItem(DISMISSED_STORAGE_KEY(courierId), JSON.stringify([...set]));
  } catch {
    /* noop */
  }
}

export default function SimilarCouriersAlert({ courierId, organizationId, disabled }: Props) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(true);
  const [dismissed, setDismissed] = useState<Set<string>>(() => loadDismissed(courierId));

  const { data: relations = [] } = useQuery({
    queryKey: ["courier-relations", courierId],
    queryFn: () => listRelationsForCourier(courierId),
    enabled: !disabled,
  });
  const linkedIds = useMemo(
    () => relations.map((r) => r.related?.id).filter((x): x is string => !!x),
    [relations],
  );

  const { data: suggestions = [] } = useQuery({
    queryKey: ["link-suggestions-bal", organizationId, courierId, linkedIds.join(",")],
    queryFn: () =>
      computeSimilarCouriers(organizationId, courierId, {
        excludeIds: linkedIds,
        limit: 5,
      }),
    enabled: !disabled,
  });

  const visibleSuggestions = suggestions.filter((s) => !dismissed.has(s.courier.id));

  const linkMutation = useMutation({
    mutationFn: async (input: {
      targetId: string;
      type: CourierRelationType;
      relanceMaster?: boolean;
    }) => {
      let source = courierId;
      let target = input.targetId;
      if (input.type === "relance" && input.relanceMaster) {
        source = input.targetId;
        target = courierId;
      }
      return createRelation({
        organizationId,
        sourceCourierId: source,
        targetCourierId: target,
        relationType: input.type,
        createdVia: "ai_suggestion",
      });
    },
    onSuccess: () => {
      toast.success("Lien créé");
      queryClient.invalidateQueries({ queryKey: ["courier-relations", courierId] });
    },
    onError: (e: Error) => {
      if (e.message.includes("duplicate")) toast.error("Ce lien existe déjà");
      else toast.error(e.message || "Erreur");
    },
  });

  if (disabled || visibleSuggestions.length === 0) return null;

  const dismiss = (id: string) => {
    const next = new Set(dismissed);
    next.add(id);
    setDismissed(next);
    saveDismissed(courierId, next);
  };

  return (
    <Alert className="border-amber-200 bg-amber-50/50">
      <AlertTriangle className="h-4 w-4 text-amber-600" />
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <AlertTitle className="flex items-center gap-2 text-amber-900">
            <Sparkles className="h-3.5 w-3.5" />
            Courriers potentiellement liés détectés ({visibleSuggestions.length})
          </AlertTitle>
          <AlertDescription className="text-amber-900/80">
            Ces courriers récents partagent l'expéditeur ou des mots-clés avec celui-ci.
          </AlertDescription>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-amber-900 hover:bg-amber-100"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>
      </div>

      {expanded && (
        <ul className="mt-3 space-y-2">
          {visibleSuggestions.map((s) => {
            const c = s.courier;
            const sender = c.courier_participants.find((p) => p.role === "sender");
            const date = c.received_at ?? c.sent_at;
            return (
              <li
                key={c.id}
                className="rounded-md border border-amber-200 bg-white px-3 py-2"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {c.chrono && <span className="font-mono">{c.chrono}</span>}
                      {date && (
                        <span>
                          {new Date(date).toLocaleDateString("fr-FR", {
                            day: "2-digit",
                            month: "2-digit",
                            year: "numeric",
                          })}
                        </span>
                      )}
                      {sender?.name && <span>· De {sender.name}</span>}
                    </div>
                    <RouterLink
                      to={`/courrier/${c.id}`}
                      className="block truncate text-sm font-medium hover:underline"
                    >
                      {c.subject ?? <span className="italic text-muted-foreground">(sans objet)</span>}
                    </RouterLink>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {s.reasons.map((r) => (
                        <Badge
                          key={r}
                          variant="secondary"
                          className="text-[10px] font-normal"
                        >
                          {r}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      disabled={linkMutation.isPending}
                      onClick={() =>
                        linkMutation.mutate({
                          targetId: c.id,
                          type: "relance",
                          relanceMaster: true,
                        })
                      }
                    >
                      Lier comme relance
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      disabled={linkMutation.isPending}
                      onClick={() =>
                        linkMutation.mutate({ targetId: c.id, type: "sujet_lie" })
                      }
                    >
                      Lier au sujet
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs text-muted-foreground"
                      onClick={() => dismiss(c.id)}
                    >
                      <X className="h-3 w-3 mr-1" /> Ignorer
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Alert>
  );
}
