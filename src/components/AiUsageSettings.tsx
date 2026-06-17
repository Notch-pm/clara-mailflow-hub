import { useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { getAiUsageSummary, upsertAiUsageQuota } from "@/services/aiUsageService";

interface AiUsageSettingsProps {
  organizationId: string;
  /** true uniquement depuis la vue superadmin — les admins d'organisation
   *  voient leur consommation en lecture seule (le plafond est un levier de
   *  maîtrise des coûts côté Notch, pas un paramètre métier délégué). */
  editable?: boolean;
}

export default function AiUsageSettings({ organizationId, editable = false }: AiUsageSettingsProps) {
  const queryClient = useQueryClient();
  const [editValue, setEditValue] = useState("");

  const { data: summary, isLoading } = useQuery({
    queryKey: ["ai-usage-summary", organizationId],
    queryFn: () => getAiUsageSummary(organizationId),
    enabled: !!organizationId,
  });

  const saveMutation = useMutation({
    mutationFn: (monthlyLimitTokens: number) => upsertAiUsageQuota(organizationId, null, monthlyLimitTokens),
    onSuccess: () => {
      toast.success("Plafond IA mis à jour");
      queryClient.invalidateQueries({ queryKey: ["ai-usage-summary", organizationId] });
      setEditValue("");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">Chargement…</CardContent>
      </Card>
    );
  }

  // Plafond global (provider=null) prioritaire s'il existe ; sinon premier
  // plafond spécifique à un fournisseur. En v1, l'édition ne propose que le
  // plafond global (un seul mode à la fois, pas de combinaison global + par
  // fournisseur, pour éviter toute ambiguïté de configuration).
  const usage = (summary ?? []).find((s) => s.provider === null) ?? summary?.[0] ?? null;

  return (
    <Card>
      <CardContent className="pt-6 space-y-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h3 className="font-medium">Consommation IA</h3>
        </div>

        {!usage ? (
          <p className="text-sm text-muted-foreground">
            Aucun plafond configuré pour cette organisation — consommation illimitée.
          </p>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Période {usage.period}</span>
              <span className="font-medium">
                {(usage.usedTokens + usage.reservedTokens).toLocaleString("fr-FR")} /{" "}
                {usage.monthlyLimitTokens.toLocaleString("fr-FR")} tokens (estimé)
              </span>
            </div>
            <Progress
              value={Math.min(100, ((usage.usedTokens + usage.reservedTokens) / usage.monthlyLimitTokens) * 100)}
            />
            {usage.reservedTokens > 0 && (
              <p className="text-xs text-muted-foreground">
                dont {usage.reservedTokens.toLocaleString("fr-FR")} en cours de traitement
              </p>
            )}
            {!usage.isActive && (
              <p className="text-xs text-muted-foreground">Plafond désactivé — consommation illimitée.</p>
            )}
          </div>
        )}

        {editable && (
          <div className="flex items-end gap-2 pt-2 border-t">
            <div className="flex flex-col gap-1.5 flex-1 max-w-[220px]">
              <Label className="text-xs text-muted-foreground">Nouveau plafond mensuel (tokens)</Label>
              <Input
                type="number"
                min={1}
                placeholder={usage ? String(usage.monthlyLimitTokens) : "ex. 1000000"}
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
              />
            </div>
            <Button
              size="sm"
              disabled={!editValue.trim() || saveMutation.isPending}
              onClick={() => saveMutation.mutate(Number(editValue))}
            >
              Enregistrer
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
