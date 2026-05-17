import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getAnalysis, type SuggestedAction } from "@/services/courierAnalysisService";

interface Props {
  courierId: string;
  onCreateTicket?: (action: SuggestedAction) => void;
  readOnly?: boolean;
}

export default function SuggestedActionsCard({ courierId, onCreateTicket, readOnly = false }: Props) {
  const { data: analysis, isLoading } = useQuery({
    queryKey: ["courier-analysis", courierId],
    queryFn: () => getAnalysis(courierId),
    enabled: !!courierId,
  });

  if (isLoading) {
    return <Skeleton className="h-24 w-full" />;
  }

  return (
    <Card className="p-3">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
        Actions suggérées
      </h4>
      {!analysis ? (
        <p className="text-xs text-muted-foreground italic">
          Lancez d'abord l'analyse depuis l'onglet « Contenu et intentions ».
        </p>
      ) : analysis.suggested_actions.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">Aucune action suggérée</p>
      ) : (
        <ul className="space-y-1.5">
          {analysis.suggested_actions.map((action, i) => (
            <li key={i} className="text-sm flex gap-2 items-start group">
              <span className="text-primary shrink-0 mt-0.5">→</span>
              <span className="flex-1">
                {action.label}
                {action.procedure_name && (
                  <span className="ml-1.5 text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
                    {action.procedure_name}
                  </span>
                )}
              </span>
              {onCreateTicket && !readOnly && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-xs shrink-0 opacity-60 group-hover:opacity-100"
                  onClick={() => onCreateTicket(action)}
                  title="Créer un ticket à partir de cette action"
                >
                  <Plus className="h-3 w-3" />
                  Ticket
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
