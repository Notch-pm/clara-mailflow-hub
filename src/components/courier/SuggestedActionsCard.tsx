import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getAnalysis } from "@/services/courierAnalysisService";

interface Props {
  courierId: string;
}

export default function SuggestedActionsCard({ courierId }: Props) {
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
            <li key={i} className="text-sm flex gap-2">
              <span className="text-primary shrink-0">→</span>
              <span>{action}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
