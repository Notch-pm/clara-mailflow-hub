import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Loader2, Inbox, RefreshCw, PlugZap } from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

interface ImapForm {
  host: string;
  port: number;
  username: string;
  password: string;
  use_tls: boolean;
  folder: string;
  auto_fetch: boolean;
}

const defaultForm: ImapForm = {
  host: "",
  port: 993,
  username: "",
  password: "",
  use_tls: true,
  folder: "INBOX",
  auto_fetch: false,
};

export default function ImapSettings({ orgId }: { orgId: string }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<ImapForm>(defaultForm);
  const [testing, setTesting] = useState(false);
  const [fetching, setFetching] = useState(false);

  const { data: settings, isLoading } = useQuery({
    queryKey: ["imap-settings", orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("imap_settings" as any)
        .select("*")
        .eq("organization_id", orgId)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
    enabled: !!orgId,
  });

  useEffect(() => {
    if (settings) {
      setForm({
        host: settings.host || "",
        port: settings.port || 993,
        username: settings.username || "",
        password: settings.password || "",
        use_tls: settings.use_tls ?? true,
        folder: settings.folder || "INBOX",
        auto_fetch: settings.auto_fetch ?? false,
      });
    }
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (settings?.id) {
        const { error } = await supabase
          .from("imap_settings" as any)
          .update({ ...form, updated_at: new Date().toISOString() } as any)
          .eq("id", settings.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("imap_settings" as any)
          .insert({ ...form, organization_id: orgId } as any);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["imap-settings", orgId] });
      toast.success("Configuration IMAP enregistrée");
    },
    onError: (e: any) => toast.error("Erreur : " + e.message),
  });

  const callFunction = async (test: boolean) => {
    const { data, error } = await supabase.functions.invoke("fetch-inbound-emails", {
      body: { organization_id: orgId, test },
    });
    if (error) {
      const errBody = typeof error === "object" && "context" in error
        ? await (error as any).context?.json?.().catch(() => null)
        : null;
      throw new Error(errBody?.error || error.message || String(error));
    }
    if (data?.error) throw new Error(data.error);
    return data;
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      await callFunction(true);
      toast.success("Connexion IMAP réussie ✓");
      queryClient.invalidateQueries({ queryKey: ["imap-settings", orgId] });
    } catch (e: any) {
      toast.error("Échec : " + (e.message || ""));
    } finally {
      setTesting(false);
    }
  };

  const handleFetchNow = async () => {
    setFetching(true);
    try {
      const data = await callFunction(false);
      toast.success(`Récupération terminée : ${data?.processed ?? 0} email(s) importé(s)`);
      queryClient.invalidateQueries({ queryKey: ["imap-settings", orgId] });
    } catch (e: any) {
      toast.error("Échec : " + (e.message || ""));
    } finally {
      setFetching(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <Inbox className="h-5 w-5 text-primary" />
          <div>
            <CardTitle className="text-base">Réception d'emails (IMAP)</CardTitle>
            <CardDescription>
              Récupère automatiquement les emails reçus sur une boîte dédiée et les transforme en courriers entrants.
              Pensez à utiliser un mot de passe d'application si la 2FA est activée (Gmail, Outlook…).
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="imap-host">Hôte IMAP</Label>
            <Input
              id="imap-host"
              placeholder="imap.gmail.com"
              value={form.host}
              onChange={(e) => setForm({ ...form, host: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="imap-port">Port</Label>
            <Input
              id="imap-port"
              type="number"
              placeholder="993"
              value={form.port}
              onChange={(e) => setForm({ ...form, port: parseInt(e.target.value) || 993 })}
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="imap-username">Identifiant (adresse e-mail)</Label>
            <Input
              id="imap-username"
              placeholder="courrier@monorga.fr"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="imap-password">Mot de passe (ou mot de passe d'application)</Label>
            <Input
              id="imap-password"
              type="password"
              placeholder="••••••••"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="imap-folder">Dossier surveillé</Label>
            <Input
              id="imap-folder"
              placeholder="INBOX"
              value={form.folder}
              onChange={(e) => setForm({ ...form, folder: e.target.value })}
            />
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <Label className="text-sm font-medium">TLS / SSL</Label>
              <p className="text-xs text-muted-foreground">Connexion sécurisée (recommandé)</p>
            </div>
            <Switch
              checked={form.use_tls}
              onCheckedChange={(val) => setForm({ ...form, use_tls: val })}
            />
          </div>
        </div>

        <div className="flex items-center justify-between rounded-lg border p-3">
          <div>
            <Label className="text-sm font-medium">Récupération automatique</Label>
            <p className="text-xs text-muted-foreground">
              Vérifie la boîte toutes les 5 minutes et crée un courrier par email reçu
            </p>
          </div>
          <Switch
            checked={form.auto_fetch}
            onCheckedChange={(val) => setForm({ ...form, auto_fetch: val })}
          />
        </div>

        {settings?.last_fetch_at && (
          <div className="rounded-lg border p-3 text-sm">
            <p className="text-muted-foreground">
              Dernière récupération :{" "}
              <span className="font-medium text-foreground">
                {format(new Date(settings.last_fetch_at), "dd/MM/yyyy HH:mm", { locale: fr })}
              </span>
            </p>
            {settings.last_error && (
              <p className="mt-1 text-destructive">Dernière erreur : {settings.last_error}</p>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-3 pt-2">
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            {saveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Enregistrer
          </Button>
          <Button variant="outline" onClick={handleTest} disabled={testing || !settings?.id}>
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}
            Tester la connexion
          </Button>
          <Button variant="outline" onClick={handleFetchNow} disabled={fetching || !settings?.id}>
            {fetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Récupérer maintenant
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
