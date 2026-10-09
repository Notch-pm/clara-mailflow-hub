import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getAnalysis, type SuggestedAction } from "@/services/courierAnalysisService";
import { listProcedures } from "@/services/procedureService";
import { procedurePartnerLabel } from "@/lib/procedure-origin";
import { useOrganization } from "@/contexts/OrganizationContext";

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

  // Même requête (et même cache) que le dialogue de demande : sert à dire si
  // la démarche suggérée part chez un éditeur partenaire plutôt que dans Iris.
  const { organizationId } = useOrganization();
  const { data: procedures } = useQuery({
    queryKey: ["procedures-displayed", organizationId],
    queryFn: () => listProcedures(organizationId!),
    enabled: !!organizationId && !!analysis?.suggested_actions.some((a) => a.procedure_id),
  });
  const partnerByProcedure = useMemo(
    () => new Map((procedures ?? []).map((p) => [p.id, procedurePartnerLabel(p)])),
    [procedures],
  );

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
                {action.procedure_id && partnerByProcedure.get(action.procedure_id) && (
                  <span
                    className="ml-1.5 text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full"
                    title="La demande sera transmise à cet éditeur partenaire, pas à Iris."
                  >
                    → {partnerByProcedure.get(action.procedure_id)}
                  </span>
                )}
                {/* Organisation à qui adresser la demande : elle décide de la
                    recevabilité de la démarche, autant la montrer ici. */}
                {action.socle_organization_name && (
                  <span className="ml-1.5 text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
                    {action.socle_organization_name}
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
