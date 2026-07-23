import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Plug, Eye, EyeOff, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface OrgIntegrationsProps {
  orgId: string;
}

const SECRET_PLACEHOLDER = "•••••••• (configuré)";

export default function OrgIntegrations({ orgId }: OrgIntegrationsProps) {
  const queryClient = useQueryClient();
  const [apiBaseUrl, setApiBaseUrl] = useState("");
  const [apiUrlTicketingapp, setApiUrlTicketingapp] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [isActive, setIsActive] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [editing, setEditing] = useState(false);
  const [testResult, setTestResult] = useState<{ status: string; message: string } | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [isSyncingProcedures, setIsSyncingProcedures] = useState(false);
  const [syncProceduresResult, setSyncProceduresResult] = useState<
    { total: number; created: number; updated: number; skipped?: number } | null
  >(null);

  // Piste d'audit de la session d'édition courante : un test réussi valide
  // temporairement l'activation ; toute modification d'un champ de connexion
  // (URL API, client_id, client_secret, access_token) invalide ce test.
  const [lastTestOk, setLastTestOk] = useState(false);
  const [connectionDirty, setConnectionDirty] = useState(false);
  // Fige l'état "actif" tel qu'il était à l'ouverture de l'écran, pour ne pas
  // exiger un nouveau test si l'utilisateur n'a rien changé aux identifiants.
  const [wasActiveOnOpen, setWasActiveOnOpen] = useState(false);

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

  const hasStoredSecret = !!integration?.client_secret;
  const hasStoredAccessToken = !!integration?.access_token;

  // L'activation n'est permise que si un test a réussi dans cette session
  // d'édition, ou si l'intégration était déjà active en base et que rien n'a
  // changé depuis l'ouverture de l'écran.
  const canActivate = lastTestOk || (wasActiveOnOpen && !connectionDirty);

  function markConnectionChanged() {
    setLastTestOk(false);
    setConnectionDirty(true);
    setTestResult(null);
    setIsActive((prev) => {
      if (prev) {
        toast.info(
          "Configuration modifiée : l'intégration a été suspendue. Testez la connexion avant de la réactiver.",
        );
        return false;
      }
      return prev;
    });
  }

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
        setLastTestOk(true);
        toast.success("Connexion réussie avec l'API Arpège");
      } else {
        setLastTestOk(false);
        toast.error(data?.message || "Échec de la connexion");
      }
    } catch (e: any) {
      setTestResult({ status: "error", message: e.message });
      setLastTestOk(false);
      toast.error("Erreur lors du test de connexion");
    } finally {
      setIsTesting(false);
    }
  }

  function validateForm(): string | null {
    if (!apiBaseUrl.trim()) return "L'URL de l'API est requise.";
    if (!clientId.trim()) return "Le Client ID est requis.";
    if (!clientSecret.trim() && !hasStoredSecret) return "Le Client Secret est requis.";
    if (isActive && !canActivate) return "Testez la connexion avant d'activer l'intégration.";
    return null;
  }

  // Le test de connexion (edge function) lit la configuration EN BASE, pas le
  // formulaire : les champs secrets modifiés doivent donc être enregistrés
  // avant de pouvoir être testés.
  async function persistIntegration() {
    const payload: any = {
      api_base_url: apiBaseUrl.trim() || null,
      api_url_ticketingapp: apiUrlTicketingapp.trim() || null,
      client_id: clientId.trim() || null,
      is_active: isActive,
    };
    // Champ vide = valeur inchangée en base : on n'écrit jamais un secret vide.
    if (clientSecret.trim()) payload.client_secret = clientSecret.trim();
    if (accessToken.trim()) payload.access_token = accessToken.trim();

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
  }

  function resetSecretInputs() {
    setClientSecret("");
    setAccessToken("");
    setShowSecret(false);
    setShowToken(false);
    setConnectionDirty(false);
  }

  const saveMutation = useMutation({
    mutationFn: persistIntegration,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["org-integration", orgId, "arpege"] });
      toast.success("Intégration Arpège enregistrée");
      setEditing(false);
      resetSecretInputs();
    },
    onError: (e: any) => toast.error("Erreur : " + e.message),
  });

  // Sauvegarde silencieuse utilisée par le bouton "Enregistrer puis tester" :
  // reste en mode édition pour laisser l'utilisateur activer l'intégration
  // une fois le test réussi.
  const saveAndTestMutation = useMutation({
    mutationFn: persistIntegration,
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ["org-integration", orgId, "arpege"] });
      resetSecretInputs();
      await handleTestConnection();
    },
    onError: (e: any) => toast.error("Erreur : " + e.message),
  });

  function handleTestClick() {
    if (connectionDirty) {
      const err = validateForm();
      if (err) {
        toast.error(err);
        return;
      }
      saveAndTestMutation.mutate();
    } else {
      handleTestConnection();
    }
  }

  function startEdit() {
    setApiBaseUrl(integration?.api_base_url || "");
    setApiUrlTicketingapp(integration?.api_url_ticketingapp || "");
    setClientId(integration?.client_id || "");
    setClientSecret("");
    setAccessToken("");
    const activeOnOpen = integration?.is_active ?? false;
    setIsActive(activeOnOpen);
    setWasActiveOnOpen(activeOnOpen);
    setLastTestOk(false);
    setConnectionDirty(false);
    setTestResult(null);
    setEditing(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const err = validateForm();
    if (err) {
      toast.error(err);
      return;
    }
    saveMutation.mutate();
  }

  const isBusy = isTesting || saveAndTestMutation.isPending || saveMutation.isPending;

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
                    {integration.is_active ? "Actif" : "Suspendu"}
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
              )}
              {syncProceduresResult && (
                <div className="flex items-center gap-2 text-sm text-success">
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
            Configurez les identifiants de connexion au partenaire Arpège (Interop.Api v2, signature Hawk).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="api-base-url">API Base URL *</Label>
              <Input
                id="api-base-url"
                value={apiBaseUrl}
                onChange={(e) => {
                  setApiBaseUrl(e.target.value);
                  markConnectionChanged();
                }}
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
              <Label htmlFor="client-id">Client ID *</Label>
              <Input
                id="client-id"
                value={clientId}
                onChange={(e) => {
                  setClientId(e.target.value);
                  markConnectionChanged();
                }}
                placeholder="Identifiant client Arpège"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="client-secret">Client Secret {!hasStoredSecret && "*"}</Label>
              <div className="relative">
                <Input
                  id="client-secret"
                  type={showSecret ? "text" : "password"}
                  value={clientSecret}
                  onChange={(e) => {
                    setClientSecret(e.target.value);
                    markConnectionChanged();
                  }}
                  placeholder={hasStoredSecret ? SECRET_PLACEHOLDER : "Secret client Arpège"}
                  required={!hasStoredSecret}
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
              {hasStoredSecret && (
                <p className="text-xs text-muted-foreground">
                  Laissez ce champ vide pour conserver le secret actuel.
                </p>
              )}
            </div>

            <Accordion type="single" collapsible defaultValue={hasStoredAccessToken ? "legacy" : undefined}>
              <AccordionItem value="legacy">
                <AccordionTrigger className="text-sm">Avancé (legacy)</AccordionTrigger>
                <AccordionContent className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Ancien mode de connexion, remplacé par la signature Hawk (client_id / client_secret)
                    ci-dessus. Ne renseignez ce champ que si le partenaire ne vous a fourni qu'un token
                    d'accès.
                  </p>
                  <div className="space-y-2">
                    <Label htmlFor="access-token">Access Token</Label>
                    <div className="relative">
                      <Input
                        id="access-token"
                        type={showToken ? "text" : "password"}
                        value={accessToken}
                        onChange={(e) => {
                          setAccessToken(e.target.value);
                          markConnectionChanged();
                        }}
                        placeholder={hasStoredAccessToken ? SECRET_PLACEHOLDER : "Token d'accès Arpège (legacy)"}
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
                    {hasStoredAccessToken && (
                      <p className="text-xs text-muted-foreground">
                        Laissez ce champ vide pour conserver le token actuel.
                      </p>
                    )}
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>

            <div className="space-y-2 pt-2">
              <div className="flex items-center gap-3">
                <Switch
                  id="integration-active"
                  checked={isActive}
                  onCheckedChange={(checked) => {
                    if (checked && !canActivate) {
                      toast.error("Testez la connexion avant d'activer l'intégration.");
                      return;
                    }
                    setIsActive(checked);
                  }}
                />
                <Label htmlFor="integration-active">
                  {!integration
                    ? "Activer l'intégration"
                    : isActive
                      ? "Suspendre l'interface"
                      : "Réactiver l'interface"}
                </Label>
              </div>
              {!canActivate && (
                <p className="text-xs text-muted-foreground">
                  Testez la connexion avant d'activer l'intégration.
                </p>
              )}
            </div>

            <div className="flex items-center gap-2 pt-2">
              <Button type="button" variant="outline" onClick={handleTestClick} disabled={isBusy}>
                {isBusy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                {connectionDirty ? "Enregistrer puis tester" : "Tester la connexion"}
              </Button>
              {connectionDirty && (
                <p className="text-xs text-muted-foreground">
                  Vos modifications seront d'abord enregistrées, puis la connexion sera testée.
                </p>
              )}
            </div>

            {testResult && (
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
            )}

            <div className="flex gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setEditing(false);
                  setTestResult(null);
                }}
              >
                Annuler
              </Button>
              <Button type="submit" disabled={saveMutation.isPending}>
                Enregistrer
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
