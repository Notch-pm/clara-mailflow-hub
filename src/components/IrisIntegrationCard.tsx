import { useQuery } from "@tanstack/react-query";
import { Inbox } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getIrisIntegrationStatus } from "@/services/irisIntegrationService";

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("fr-FR") : null);

/**
 * Connexion Iris — lecture seule. Elle vient de l'abonnement de la collectivité
 * à Iris dans le Socle (« Applications souscrites ») : cocher Iris et Clara
 * suffit, décocher Iris la suspend à la synchronisation suivante.
 */
export default function IrisIntegrationCard({ orgId }: { orgId: string }) {
  const { data: iris, isLoading } = useQuery({
    queryKey: ["org-integration", orgId, "iris"],
    queryFn: () => getIrisIntegrationStatus(orgId),
  });
  if (isLoading) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <Inbox className="h-5 w-5 text-primary" />
        </div>
        <div className="flex flex-1 items-center gap-2">
          <CardTitle className="text-base">Iris — demandes des usagers</CardTitle>
          {iris ? (
            <Badge variant={iris.is_active ? "default" : "secondary"}>{iris.is_active ? "Actif" : "Suspendu"}</Badge>
          ) : (
            <Badge variant="outline">Non souscrit</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-1 pt-0 text-sm text-muted-foreground">
        <p>
          {iris?.is_active
            ? "Les actions fondées sur une démarche sont déposées dans Iris."
            : iris
              ? "Iris n'est plus souscrit pour cette collectivité : plus aucun dépôt, le suivi des demandes déjà déposées continue."
              : "Iris n'est pas souscrit pour cette collectivité."}{" "}
          Géré dans le Socle (fiche du client, « Applications souscrites ») : rien à configurer dans Clara.
        </p>
        {iris?.socle_synced_at && <p>Dernière synchronisation du référentiel : {fmt(iris.socle_synced_at)}.</p>}
        {iris?.last_sync_at && <p>Dernier suivi des demandes : {fmt(iris.last_sync_at)}.</p>}
      </CardContent>
    </Card>
  );
}
