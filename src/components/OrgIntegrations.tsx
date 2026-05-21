import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Plug, Eye, EyeOff, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface OrgIntegrationsProps {
  orgId: string;
}

export default function OrgIntegrations({ orgId }: OrgIntegrationsProps) {
  const queryClient = useQueryClient();
  const [apiBaseUrl, setApiBaseUrl] = useState("");
  const [apiUrlTicketingapp, setApiUrlTicketingapp] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [showSecret, setShowSecret] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [editing, setEditing] = useState(false);
  const [testResult, setTestResult] = useState<{ status: string; message: string } | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [isSyncingProcedures, setIsSyncingProcedures] = useState(false);
  const [syncProceduresResult, setSyncProceduresResult] = useState<
    { total: number; created: number; updated: number; skipped?: number } | null
  >(null);

  async function handleSyncProcedures() {
    setIsSyncingProcedures(true);
    setSyncProceduresResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("sync-arpege-services", {
        body: { organization_id: orgId },
      });
      if (error) throw error;
      setSyncProceduresResult(data);
      queryClient.invalidateQueries({ queryKey: ["procedures", orgId] });
      toast.success(
        `Synchronisation : ${data?.created ?? 0} créées, ${data?.updated ?? 0} mises à jour`,
      );
    } catch (e: any) {
      toast.error("Erreur lors de la synchronisation : " + e.message);
    } finally {
      setIsSyncingProcedures(false);
    }
  }

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
    } catch (e: any) {
      setTestResult({ status: "error", message: e.message });
      toast.error("Erreur lors du test de connexion");
    } finally {
      setIsTesting(false);
    }
  }

  const { data: integration, isLoading } = useQuery({
    queryKey: ["org-integration", orgId, "arpege"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organization_integrations" as any)
        .select("*")
        .eq("organization_id", orgId)
        .eq("provider", "arpege")
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

  const upsertMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        client_id: clientId,
        client_secret: clientSecret,
        is_active: isActive,
        api_base_url: apiBaseUrl || null,
        access_token: accessToken || null,
        api_url_ticketingapp: apiUrlTicketingapp || null,
      } as any;

      if (integration) {
        const { error } = await supabase
          .from("organization_integrations" as any)
          .update(payload)
          .eq("id", integration.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("organization_integrations" as any)
          .insert({
            organization_id: orgId,
            provider: "arpege",
            ...payload,
          });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["org-integration", orgId, "arpege"] });
      toast.success("Intégration Arpège enregistrée");
      setEditing(false);
      setShowSecret(false);
      setShowToken(false);
    },
    onError: (e) => toast.error("Erreur : " + e.message),
  });

  function startEdit() {
    setApiBaseUrl(integration?.api_base_url || "");
    setApiUrlTicketingapp(integration?.api_url_ticketingapp || "");
    setClientId(integration?.client_id || "");
    setClientSecret(integration?.client_secret || "");
    setAccessToken(integration?.access_token || "");
    setIsActive(integration?.is_active ?? true);
    setEditing(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!apiBaseUrl.trim() || !accessToken.trim()) {
      toast.error("L'URL de l'API et le token d'accès sont requis");
      return;
    }
    upsertMutation.mutate();
  }

  if (isLoading) return null;

  // Display mode
  if (!editing) {
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
                    {integration.is_active ? "Actif" : "Inactif"}
                  </Badge>
                ) : (
                  <Badge variant="outline">Non configuré</Badge>
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
            <div className="gap-2 flex flex-col">
              {integration?.is_active && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSyncProcedures}
                    disabled={isSyncingProcedures}
                  >
                    {isSyncingProcedures ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                    Récupérer les démarches
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleTestConnection} disabled={isTesting}>
                    {isTesting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                    Tester la connexion API
                  </Button>
                </>
              )}
              <Button variant="outline" size="sm" onClick={startEdit}>
                {integration ? "Modifier" : "Configurer"}
              </Button>
            </div>
          </CardHeader>
          {(testResult || syncProceduresResult) && (
            <CardContent className="pt-0 space-y-2">
              {testResult && (
                <div
                  className={`flex items-center gap-2 text-sm ${
                    testResult.status === "success" ? "text-green-600" : "text-destructive"
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
              )}
              {syncProceduresResult && (
                <div className="flex items-center gap-2 text-sm text-green-600">
                  <CheckCircle2 className="h-4 w-4" />
                  {syncProceduresResult.created} démarche(s) créée(s),{" "}
                  {syncProceduresResult.updated} mise(s) à jour
                  {typeof syncProceduresResult.skipped === "number"
                    ? `, ${syncProceduresResult.skipped} inchangée(s)`
                    : ""}
                </div>
              )}
            </CardContent>
          )}
        </Card>
      </div>
    );
  }

  // Edit mode
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Intégrations externes</h2>
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Plug className="h-4 w-4" />
            Configuration Arpège
          </CardTitle>
          <CardDescription>
            Configurez les identifiants de connexion au partenaire Arpège (Interop.Api v2).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="api-base-url">API Base URL *</Label>
              <Input
                id="api-base-url"
                value={apiBaseUrl}
                onChange={(e) => setApiBaseUrl(e.target.value)}
                placeholder="https://api.espace-citoyens.net"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="api-url-ticketingapp">URL Espace Agent (optionnel)</Label>
              <Input
                id="api-url-ticketingapp"
                value={apiUrlTicketingapp}
                onChange={(e) => setApiUrlTicketingapp(e.target.value)}
                placeholder="https://agent.espace-citoyens.net"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="client-id">Client ID</Label>
              <Input
                id="client-id"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="Identifiant client Arpège"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="client-secret">Client Secret</Label>
              <div className="relative">
                <Input
                  id="client-secret"
                  type={showSecret ? "text" : "password"}
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  placeholder="Secret client Arpège"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8"
                  aria-label={showSecret ? "Masquer le secret" : "Afficher le secret"}
                  onClick={() => setShowSecret(!showSecret)}
                >
                  {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="access-token">Access Token *</Label>
              <div className="relative">
                <Input
                  id="access-token"
                  type={showToken ? "text" : "password"}
                  value={accessToken}
                  onChange={(e) => setAccessToken(e.target.value)}
                  placeholder="Token d'accès Arpège"
                  required
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8"
                  aria-label={showToken ? "Masquer le token" : "Afficher le token"}
                  onClick={() => setShowToken(!showToken)}
                >
                  {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Switch id="integration-active" checked={isActive} onCheckedChange={setIsActive} />
              <Label htmlFor="integration-active">Activer l'intégration</Label>
            </div>
            <div className="flex gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setEditing(false)}>
                Annuler
              </Button>
              <Button type="submit" disabled={upsertMutation.isPending}>
                Enregistrer
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
