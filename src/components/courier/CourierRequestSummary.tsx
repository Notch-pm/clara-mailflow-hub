import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { CircleDashed, Loader2, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { getAnalysis } from "@/services/courierAnalysisService";
import { getLatestAnalysisJob, isAnalysisJobInProgress } from "@/services/courierAnalysisJobService";
import { courierAnalysisJobQueryKey } from "@/hooks/useCourierAnalysisJob";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { pendingAnalysisItems, type PendingAnalysisArgs } from "@/lib/analysis-pending";

interface Props {
  courierId: string;
  organizationId: string;
  /** Mène à l'onglet « Actions liées », où se crée la demande ou la tâche. */
  onCreateAction?: () => void;
  /** Détail de l'analyse (extraits, champs suggérés, tags), ouvert en volet. */
  analysisDetail: ReactNode;
  /**
   * De quoi compter les propositions non appliquées (pastille du bouton
   * « Détail de l'analyse »). Absent, ou courrier en lecture seule : pas de
   * pastille — l'agent n'aurait aucun geste à faire.
   */
  pendingContext?: Omit<PendingAnalysisArgs, "analysis"> | null;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

/**
 * « Ce que demande l'usager » : le résumé et les actions suggérées par
 * l'analyse, en tête de l'onglet d'arrivée — c'est la première question de
 * l'agent. Le détail (extraits, titre et organisation suggérés, tags) reste
 * à un clic, dans un volet latéral.
 */
export default function CourierRequestSummary({
  courierId,
  organizationId,
  onCreateAction,
  analysisDetail,
  pendingContext = null,
}: Props) {
  const [detailOpen, setDetailOpen] = useState(false);

  const { data: analysis, isLoading } = useQuery({
    queryKey: ["courier-analysis", courierId],
    queryFn: () => getAnalysis(courierId),
    enabled: !!courierId,
  });
  const { data: analysisJob } = useQuery({
    queryKey: courierAnalysisJobQueryKey(courierId),
    queryFn: () => getLatestAnalysisJob(organizationId, courierId),
    enabled: !!courierId && !!organizationId,
  });
  const queued = isAnalysisJobInProgress(analysisJob);
  const actions = analysis?.suggested_actions ?? [];
  const pending = pendingContext ? pendingAnalysisItems({ ...pendingContext, analysis: analysis ?? null }) : [];

  return (
    <Card className="flex flex-col gap-3.5 p-6 shadow-airbnb-sm">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold leading-tight">Ce que demande l'usager</h2>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
            {queued ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
            )}
            {queued
              ? "Lecture et analyse en cours…"
              : analysis
                ? `Résumé et actions détectés par l'analyse du ${formatDate(analysis.updated_at)}`
                : "Aucune analyse pour ce courrier"}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setDetailOpen(true)}
            className="text-sm font-semibold text-primary hover:underline"
            aria-label={
              pending.length > 0
                ? `Détail de l'analyse — ${pending.length} proposition${pending.length > 1 ? "s" : ""} à examiner`
                : undefined
            }
          >
            {analysis ? "Détail de l'analyse" : "Analyser"}
          </button>
          {/* Propositions non appliquées (titre, tags, organisation) : elles
              sont dans le volet, la pastille dit qu'une décision attend. */}
          {pending.length > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  aria-hidden
                  className="grid h-5 min-w-5 cursor-default place-items-center rounded-full bg-primary px-1.5 text-[11px] font-bold leading-none text-primary-foreground"
                >
                  {pending.length}
                </span>
              </TooltipTrigger>
              <TooltipContent align="end" className="max-w-64">
                <p className="mb-1 font-semibold">
                  {pending.length} proposition{pending.length > 1 ? "s" : ""} non appliquée{pending.length > 1 ? "s" : ""}
                </p>
                <ul className="space-y-0.5">
                  {pending.map((item, i) => (
                    <li key={i}>{item.label}</li>
                  ))}
                </ul>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      {isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : analysis?.summary ? (
        <p className="text-base leading-relaxed [text-wrap:pretty]">{analysis.summary}</p>
      ) : !queued ? (
        <p className="text-sm text-muted-foreground">
          L'analyse résume le courrier, propose un titre, une organisation gestionnaire, des tags et les actions à
          mettre en œuvre.
        </p>
      ) : null}

      {actions.length > 0 && (
        <ul className="flex flex-col gap-2">
          {actions.map((action, i) => (
            <li key={i} className="flex items-center gap-3 rounded-lg bg-muted/60 px-3.5 py-2.5 text-sm">
              <CircleDashed className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="font-semibold">{action.label}</span>
                {(action.procedure_name || action.socle_organization_name) && (
                  <span className="block text-xs text-muted-foreground">
                    {[action.procedure_name && `Démarche « ${action.procedure_name} »`, action.socle_organization_name]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                )}
              </span>
              {onCreateAction && (
                <button
                  type="button"
                  onClick={onCreateAction}
                  className="shrink-0 text-sm font-semibold text-primary hover:underline"
                >
                  Créer l'action
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <Sheet open={detailOpen} onOpenChange={setDetailOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader className="mb-4">
            <SheetTitle>Analyse du courrier</SheetTitle>
            <SheetDescription>
              Texte extrait des documents, champs suggérés et tags proposés par l'analyse.
            </SheetDescription>
          </SheetHeader>
          {analysisDetail}
        </SheetContent>
      </Sheet>
    </Card>
  );
}
