import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Loader2, Mail, Send, Server } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

interface SmtpForm {
  host: string;
  port: number;
  username: string;
  password: string;
  from_email: string;
  from_name: string;
  use_tls: boolean;
}

const defaultForm: SmtpForm = {
  host: "",
  port: 587,
  username: "",
  password: "",
  from_email: "",
  from_name: "",
  use_tls: true,
};

interface SmtpSettingsRow extends SmtpForm {
  id: string;
  organization_id: string;
  updated_at?: string;
}

interface InvokeErrorWithContext extends Error {
  context?: { json?: () => Promise<{ error?: string } | null> };
}

export default function SmtpSettings({ orgId }: { orgId: string }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<SmtpForm>(defaultForm);
  const [testDialogOpen, setTestDialogOpen] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const [sending, setSending] = useState(false);

  const { data: settings, isLoading } = useQuery({
    queryKey: ["smtp-settings", orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("smtp_settings" as never)
        .select("*")
        .eq("organization_id", orgId)
        .maybeSingle();
      if (error) throw error;
      return data as SmtpSettingsRow | null;
    },
    enabled: !!orgId,
  });

  useEffect(() => {
    if (settings) {
      setForm({
        host: settings.host || "",
        port: settings.port || 587,
        username: settings.username || "",
        password: settings.password || "",
        from_email: settings.from_email || "",
        from_name: settings.from_name || "",
        use_tls: settings.use_tls ?? true,
      });
    }
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (settings?.id) {
        const { error } = await supabase
          .from("smtp_settings" as never)
          .update({ ...form, updated_at: new Date().toISOString() })
          .eq("id", settings.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("smtp_settings" as never)
          .insert({ ...form, organization_id: orgId });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["smtp-settings", orgId] });
      toast.success("Configuration SMTP enregistrée");
    },
    onError: (e) => toast.error("Erreur : " + e.message),
  });

  const handleSendTest = async () => {
    if (!testEmail) return;
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-test-email", {
        body: { to: testEmail, organization_id: orgId },
      });
      if (error) {
        const errBody = typeof error === "object" && "context" in error
          ? await (error as InvokeErrorWithContext).context?.json?.().catch(() => null)
          : null;
        const errMsg = errBody?.error || error.message || String(error);
        throw new Error(errMsg);
      }
      if (data?.error) throw new Error(data.error);
      if (!data?.success) throw new Error("Réponse inattendue du serveur");
      toast.success("E-mail de test envoyé avec succès !");
      setTestDialogOpen(false);
      setTestEmail("");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "";
      if (msg.includes("Authentication failed") || msg.includes("Invalid login") || msg.includes("EAUTH")) {
        toast.error("Authentification SMTP échouée : vérifiez l'identifiant et le mot de passe configurés.");
      } else if (msg.includes("ECONNREFUSED") || msg.includes("ETIMEDOUT") || msg.includes("getaddrinfo")) {
        toast.error("Impossible de se connecter au serveur SMTP : vérifiez l'hôte et le port.");
      } else {
        toast.error("Échec de l'envoi : " + msg);
      }
    } finally {
      setSending(false);
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
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <Server className="h-5 w-5 text-primary" />
            <div>
              <CardTitle className="text-base">Serveur SMTP</CardTitle>
              <CardDescription>
                Configurez le serveur SMTP utilisé pour l'envoi des e-mails de notification
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="smtp-host">Hôte SMTP</Label>
              <Input
                id="smtp-host"
                placeholder="smtp.example.com"
                value={form.host}
                onChange={(e) => setForm({ ...form, host: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="smtp-port">Port</Label>
              <Input
                id="smtp-port"
                type="number"
                placeholder="587"
                value={form.port}
                onChange={(e) => setForm({ ...form, port: parseInt(e.target.value) || 587 })}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="smtp-username">Identifiant</Label>
              <Input
                id="smtp-username"
                placeholder="user@example.com"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="smtp-password">Mot de passe</Label>
              <Input
                id="smtp-password"
                type="password"
                placeholder="••••••••"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="smtp-from-email">E-mail expéditeur</Label>
              <Input
                id="smtp-from-email"
                placeholder="noreply@example.com"
                value={form.from_email}
                onChange={(e) => setForm({ ...form, from_email: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="smtp-from-name">Nom expéditeur</Label>
              <Input
                id="smtp-from-name"
                placeholder="Mon Organisation"
                value={form.from_name}
                onChange={(e) => setForm({ ...form, from_name: e.target.value })}
              />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <Label className="text-sm font-medium">Utiliser TLS</Label>
              <p className="text-xs text-muted-foreground">Connexion sécurisée au serveur SMTP</p>
            </div>
            <Switch
              checked={form.use_tls}
              onCheckedChange={(val) => setForm({ ...form, use_tls: val })}
            />
          </div>

          <div className="flex gap-3 pt-2">
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              {saveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Enregistrer
            </Button>
            <Button
              variant="outline"
              onClick={() => setTestDialogOpen(true)}
              disabled={!settings?.id}
            >
              <Send className="h-4 w-4" />
              Envoyer un mail de test
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={testDialogOpen} onOpenChange={setTestDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" />
              Envoyer un e-mail de test
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="test-email">Adresse e-mail du destinataire</Label>
            <Input
              id="test-email"
              type="email"
              placeholder="destinataire@example.com"
              value={testEmail}
              onChange={(e) => setTestEmail(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTestDialogOpen(false)}>
              Annuler
            </Button>
            <Button onClick={handleSendTest} disabled={sending || !testEmail}>
              {sending && <Loader2 className="h-4 w-4 animate-spin" />}
              Envoyer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
