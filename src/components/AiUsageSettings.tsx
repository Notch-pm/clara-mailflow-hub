import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Sparkles } from "lucide-react";
import {
  formatTokens,
  getAiUsageSummary,
  quotaView,
  renewalLabel,
} from "@/services/aiUsageService";

/**
 * Consommation IA de la collectivité.
 *
 * ⚠️ ÉCRAN EN LECTURE SEULE, ET DÉFINITIVEMENT. Depuis la centralisation du
 * 2026-08-29, le plafond est celui de la COLLECTIVITÉ, tenu par le Socle pour
 * toute la gamme (Clara, Iris, Ariane). Le champ « nouveau plafond mensuel »
 * qui vivait ici a été retiré : il n'aurait plus réglé que la part de Clara,
 * c'est-à-dire rien — le compteur est commun. Le plafond se règle dans le
 * Socle, par un super admin, et s'applique partout à la fois.
 *
 * Ce que la bascule fait GAGNER à cet écran : la ventilation par application.
 * Un administrateur voit enfin ce que sa collectivité dépense en tout, et par
 * quel produit — un total que Clara seule ne pouvait pas produire.
 */
interface AiUsageSettingsProps {
  organizationId: string;
}

const TONE_CLASSES: Record<string, string> = {
  ok: "text-muted-foreground",
  warn: "text-amber-600 dark:text-amber-500",
  critical: "text-destructive",
};

/** Nom d'affichage des applications de la gamme ; inconnu ⇒ tel quel. */
const CONSUMER_LABELS: Record<string, string> = {
  clara: "Clara (courrier)",
  iris: "Iris (demandes)",
  ariane: "Ariane",
};

export default function AiUsageSettings({ organizationId }: AiUsageSettingsProps) {
  const { data: summary, isLoading, error } = useQuery({
    queryKey: ["ai-usage-summary", organizationId],
    queryFn: () => getAiUsageSummary(organizationId),
    enabled: !!organizationId,
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">Chargement…</CardContent>
      </Card>
    );
  }

  if (error || !summary) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Consommation IA indisponible — le référentiel n'a pas répondu.
        </CardContent>
      </Card>
    );
  }

  const view = quotaView(summary);
  const renewal = renewalLabel(summary.renewsAt);

  return (
    <Card>
      <CardContent className="pt-6 space-y-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h3 className="font-medium">Consommation IA</h3>
        </div>

        <p className="text-xs text-muted-foreground">
          Le crédit est celui de votre collectivité, commun à toutes les applications de la gamme.
          Il se règle dans le Socle.
        </p>

        {view.unlimited ? (
          <p className="text-sm text-muted-foreground">
            Aucun plafond configuré pour cette collectivité — consommation illimitée.
          </p>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                Période {summary.period}
                {renewal && ` — renouvellement le ${renewal}`}
              </span>
              <span className={`font-medium ${TONE_CLASSES[view.tone]}`}>
                {formatTokens(view.engagedTokens)} / {formatTokens(view.limitTokens ?? 0)} jetons
              </span>
            </div>
            <Progress value={view.percent} />
            {view.reservedTokens > 0 && (
              <p className="text-xs text-muted-foreground">
                dont {formatTokens(view.reservedTokens)} en cours de traitement
              </p>
            )}
            {view.tone === "critical" && (
              <p className="text-xs text-destructive">
                Plafond atteint : les traitements IA sont suspendus
                {renewal ? ` jusqu'au ${renewal}` : ""}.
              </p>
            )}
          </div>
        )}

        {summary.byConsumer.length > 0 && (
          <div className="space-y-1 pt-2 border-t">
            <p className="text-xs font-medium text-muted-foreground">Par application</p>
            <ul className="space-y-1">
              {summary.byConsumer.map((row) => (
                <li
                  key={`${row.consumer}:${row.feature ?? ""}`}
                  className="flex items-center justify-between text-sm"
                >
                  <span>
                    {CONSUMER_LABELS[row.consumer] ?? row.consumer}
                    {row.feature && (
                      <span className="text-muted-foreground"> · {row.feature}</span>
                    )}
                  </span>
                  <span className="text-muted-foreground">
                    {formatTokens(row.tokens)} jetons ({row.calls} appel{row.calls > 1 ? "s" : ""})
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
