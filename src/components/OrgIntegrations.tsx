import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plug, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface OrgIntegrationsProps {
  orgId: string;
}

/** Ce que l'écran affiche — jamais les secrets (`client_secret`, `access_token`). */
interface ArpegeIntegrationView {
  is_active: boolean | null;
  api_base_url: string | null;
  api_url_ticketingapp: string | null;
  client_id: string | null;
  socle_synced_at: string | null;
}

// La configuration Arpège se saisit dans le Socle (fiche du client, section
// « Intégrations ») et la sync du référentiel la recopie : cet écran ne fait
// que l'afficher et la mettre à l'épreuve. La base refuse d'ailleurs toute
// écriture cliente d'une ligne Arpège.
//
// Les DÉMARCHES Arpège aussi viennent du Socle depuis le 2026-10-02 : importées
// sur la fiche du client (Intégrations → Arpège), activées par organisation,
// elles arrivent par la sync du référentiel. Plus de « Récupérer les démarches ».
export default function OrgIntegrations({ orgId }: OrgIntegrationsProps) {
  const [testResult, setTestResult] = useState<{ status: string; message: string } | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  const { data: integration, isLoading } = useQuery({
    queryKey: ["org-integration", orgId, "arpege"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organization_integrations")
        .select("is_active, api_base_url, api_url_ticketingapp, client_id, socle_synced_at")
        .eq("organization_id", orgId)
        .eq("provider", "arpege")
        .maybeSingle();
      if (error) throw error;
      // `socle_synced_at` manque aux types générés (colonne du 2026-10-02).
      return data as unknown as ArpegeIntegrationView | null;
    },
  });

  async function handleTestConnection() {
    setIsTesting(true);
    setTestResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("test-arpege-connection", {
        body: { organization_id: orgId },
      });
      if (error) throw error;
      setTestResult(data);
      if (data?.status === "success") {
        toast.success("Connexion réussie avec l'API Arpège");
      } else {
        toast.error(data?.message || "Échec de la connexion");
      }
    } catch (e) {
      setTestResult({ status: "error", message: e instanceof Error ? e.message : String(e) });
      toast.error("Erreur lors du test de connexion");
    } finally {
      setIsTesting(false);
    }
  }

  if (isLoading) return null;

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Intégrations externes</h2>
      <Card>
        <CardHeader className="flex flex-row items-center gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Plug className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <CardTitle className="text-base">Intégration Arpège</CardTitle>
              {integration ? (
                <Badge variant={integration.is_active ? "default" : "secondary"}>
                  {integration.is_active ? "Actif" : "Suspendu"}
                </Badge>
              ) : (
                <Badge variant="outline">Non configurée</Badge>
              )}
            </div>
            {integration && (
              <CardDescription className="mt-1">
                API : {integration.api_base_url || "—"} · Client ID : {integration.client_id || "—"}
                {integration.api_url_ticketingapp && (
                  <> · Espace agent : {integration.api_url_ticketingapp}</>
                )}
              </CardDescription>
            )}
          </div>
          {integration?.is_active && (
            <Button variant="outline" size="sm" onClick={handleTestConnection} disabled={isTesting}>
              {isTesting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Tester la connexion API
            </Button>
          )}
        </CardHeader>
        <CardContent className="pt-0">
          <p className="text-sm text-muted-foreground">
            {integration ? (
              <>
                Configuration gérée dans le Socle (fiche du client, section « Intégrations ») et
                recopiée à chaque synchronisation du référentiel, comme les démarches Arpège
                qui y sont importées et activées
                {integration.socle_synced_at
                  ? ` — dernière le ${new Date(integration.socle_synced_at).toLocaleString("fr-FR")}`
                  : ""}
                .
              </>
            ) : (
              "Non configurée — à configurer dans le Socle (fiche du client, section « Intégrations »)."
            )}
          </p>
        </CardContent>
        {testResult && (
          <CardContent className="pt-0">
            <div
              className={`flex items-center gap-2 text-sm ${
                testResult.status === "success" ? "text-success" : "text-destructive"
              }`}
            >
              {testResult.status === "success" ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <XCircle className="h-4 w-4" />
              )}
              {testResult.status === "success"
                ? "Connexion réussie avec l'API Arpège"
                : `Impossible de se connecter à l'API Arpège : ${testResult.message}`}
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
