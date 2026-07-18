import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, Inbox, RefreshCw, PlugZap, Plus, Pencil, Trash2, Building2, Scan } from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { listSocleOrganizationTree } from "@/services/socleSyncService";
import { buildSocleOrgTree, flattenSocleOrgTree } from "@/lib/socleOrgTree";

const NO_ORG_VALUE = "__none__";

interface ImapForm {
  label: string;
  host: string;
  port: number;
  username: string;
  password: string;
  use_tls: boolean;
  folder: string;
  auto_fetch: boolean;
  socle_organization_id: string | null;
  /** Boîte alimentée par un copieur : ingestion en mode numérisation. */
  is_scan_inbox: boolean;
  /** Adresses autorisées à déposer. Saisi en texte, séparé par virgules ou retours. */
  scan_allowed_senders: string[] | null;
}

const defaultForm: ImapForm = {
  label: "",
  host: "",
  port: 993,
  username: "",
  password: "",
  use_tls: true,
  folder: "INBOX",
  auto_fetch: false,
  socle_organization_id: null,
  is_scan_inbox: false,
  scan_allowed_senders: null,
};

/** « a@x.fr, b@y.fr » ou une adresse par ligne → tableau normalisé. */
function parseAllowedSenders(raw: string): string[] | null {
  const list = raw
    .split(/[\s,;]+/)
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean);
  // NULL et non [] : un tableau vide signifierait « aucun expéditeur autorisé »,
  // ce qui bloquerait toute la boîte.
  return list.length ? list : null;
}

interface ImapSettingsRow extends ImapForm {
  id: string;
  organization_id: string;
  last_fetch_at: string | null;
  last_error: string | null;
  updated_at?: string;
}

interface InvokeErrorWithContext extends Error {
  context?: { json?: () => Promise<{ error?: string } | null> };
}

export default function ImapSettings({ orgId }: { orgId: string }) {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<ImapSettingsRow | null>(null);
  const [form, setForm] = useState<ImapForm>(defaultForm);
  const [actionLoading, setActionLoading] = useState<Record<string, "test" | "fetch" | null>>({});

  const { data: settings = [], isLoading } = useQuery({
    queryKey: ["imap-settings", orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("imap_settings" as never)
        .select("*")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ImapSettingsRow[];
    },
    enabled: !!orgId,
  });

  const { data: org } = useQuery({
    queryKey: ["org-general", orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organizations" as never)
        .select("multiple_imap")
        .eq("id", orgId)
        .single();
      if (error) throw error;
      return data as unknown as { multiple_imap: boolean };
    },
    enabled: !!orgId,
  });

  const canAddMore = (org?.multiple_imap ?? false) || settings.length === 0;

  // Organisations miroir Socle : sélecteur affiché seulement si le miroir est peuplé.
  const { data: socleOrgs = [] } = useQuery({
    queryKey: ["socle-organizations", orgId],
    queryFn: () => listSocleOrganizationTree(orgId),
    enabled: !!orgId,
  });
  const orgOptions = flattenSocleOrgTree(buildSocleOrgTree(socleOrgs)).filter(
    (o) => o.status !== "obsolete" && o.obsoleted_at === null,
  );
  const orgNameById = new Map(socleOrgs.map((o) => [o.id, o.name]));

  function openAdd() {
    setEditingRow(null);
    setForm(defaultForm);
    setDialogOpen(true);
  }

  function openEdit(row: ImapSettingsRow) {
    setEditingRow(row);
    setForm({
      label: row.label || "",
      host: row.host || "",
      port: row.port || 993,
      username: row.username || "",
      password: row.password || "",
      use_tls: row.use_tls ?? true,
      folder: row.folder || "INBOX",
      auto_fetch: row.auto_fetch ?? false,
      socle_organization_id: row.socle_organization_id ?? null,
      is_scan_inbox: row.is_scan_inbox ?? false,
      scan_allowed_senders: row.scan_allowed_senders ?? null,
    });
    setDialogOpen(true);
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (editingRow) {
        const { error } = await supabase
          .from("imap_settings")
          .update({ ...form, updated_at: new Date().toISOString() } as never)
          .eq("id", editingRow.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("imap_settings")
          .insert({ ...form, organization_id: orgId } as never);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["imap-settings", orgId] });
      toast.success("Configuration IMAP enregistrée");
      setDialogOpen(false);
    },
    onError: (e: Error) => toast.error("Erreur : " + e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("imap_settings" as never).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["imap-settings", orgId] });
      toast.success("Configuration supprimée");
    },
    onError: (e: Error) => toast.error("Erreur : " + e.message),
  });

  const callFunction = async (settingsId: string, test: boolean) => {
    const { data, error } = await supabase.functions.invoke("fetch-inbound-emails", {
      body: { organization_id: orgId, settings_id: settingsId, test },
    });
    if (error) {
      const errBody =
        typeof error === "object" && "context" in error
          ? await (error as InvokeErrorWithContext).context?.json?.().catch(() => null)
          : null;
      throw new Error(errBody?.error || error.message || String(error));
    }
    if (data?.error) throw new Error(data.error);
    return data;
  };

  const handleTest = async (row: ImapSettingsRow) => {
    setActionLoading((l) => ({ ...l, [row.id]: "test" }));
    try {
      await callFunction(row.id, true);
      toast.success("Connexion IMAP réussie ✓");
      queryClient.invalidateQueries({ queryKey: ["imap-settings", orgId] });
    } catch (e: unknown) {
      toast.error("Échec : " + (e instanceof Error ? e.message : ""));
    } finally {
      setActionLoading((l) => ({ ...l, [row.id]: null }));
    }
  };

  const handleFetchNow = async (row: ImapSettingsRow) => {
    setActionLoading((l) => ({ ...l, [row.id]: "fetch" }));
    try {
      const data = await callFunction(row.id, false);
      toast.success(`Récupération terminée : ${data?.processed ?? 0} email(s) importé(s)`);
      queryClient.invalidateQueries({ queryKey: ["imap-settings", orgId] });
    } catch (e: unknown) {
      toast.error("Échec : " + (e instanceof Error ? e.message : ""));
    } finally {
      setActionLoading((l) => ({ ...l, [row.id]: null }));
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
    <>
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <Inbox className="h-5 w-5 text-primary shrink-0" />
              <div>
                <CardTitle className="text-base">Réception d'emails (IMAP)</CardTitle>
                <CardDescription>
                  Récupère automatiquement les emails reçus et les transforme en courriers entrants.
                  Pensez à utiliser un mot de passe d'application si la 2FA est activée (Gmail, Outlook…).
                </CardDescription>
              </div>
            </div>
            {canAddMore && (
              <Button size="sm" onClick={openAdd} className="shrink-0">
                <Plus className="h-4 w-4" />
                Ajouter
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {settings.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              Aucune configuration IMAP. Cliquez sur « Ajouter » pour en créer une.
            </p>
          ) : (
            <div className="space-y-3">
              {settings.map((row) => {
                const loading = actionLoading[row.id];
                return (
                  <div key={row.id} className="rounded-lg border p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">{row.label || "Sans libellé"}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {row.username} — {row.host}:{row.port}
                        </p>
                        {row.socle_organization_id && orgNameById.has(row.socle_organization_id) && (
                          <p className="text-xs text-muted-foreground inline-flex items-center gap-1 mt-0.5">
                            <Building2 className="h-3 w-3" />
                            {orgNameById.get(row.socle_organization_id)}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {row.is_scan_inbox && (
                          <Badge variant="outline" className="text-xs gap-1">
                            <Scan className="h-3 w-3" />
                            Numérisation
                          </Badge>
                        )}
                        <Badge variant={row.auto_fetch ? "default" : "secondary"} className="text-xs">
                          {row.auto_fetch ? "Auto" : "Manuel"}
                        </Badge>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          onClick={() => openEdit(row)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 text-destructive hover:text-destructive"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Supprimer cette configuration ?</AlertDialogTitle>
                              <AlertDialogDescription>
                                La configuration « {row.label || row.username} » sera définitivement supprimée.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Annuler</AlertDialogCancel>
                              <AlertDialogAction onClick={() => deleteMutation.mutate(row.id)}>
                                Supprimer
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>

                    {row.last_fetch_at && (
                      <p className="text-xs text-muted-foreground">
                        Dernière récupération :{" "}
                        <span className="font-medium text-foreground">
                          {format(new Date(row.last_fetch_at), "dd/MM/yyyy HH:mm", { locale: fr })}
                        </span>
                        {row.last_error && (
                          <span className="ml-2 text-destructive">— {row.last_error}</span>
                        )}
                      </p>
                    )}

                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleTest(row)}
                        disabled={!!loading}
                      >
                        {loading === "test" ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <PlugZap className="h-3.5 w-3.5" />
                        )}
                        Tester
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleFetchNow(row)}
                        disabled={!!loading}
                      >
                        {loading === "fetch" ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3.5 w-3.5" />
                        )}
                        Récupérer
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingRow ? "Modifier la configuration IMAP" : "Nouvelle configuration IMAP"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="imap-label">Libellé</Label>
              <Input
                id="imap-label"
                placeholder="Ex : Courriers entrants"
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
              />
            </div>

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

            {orgOptions.length > 0 && (
              <div className="space-y-2">
                <Label>Organisation</Label>
                <Select
                  value={form.socle_organization_id ?? NO_ORG_VALUE}
                  onValueChange={(val) =>
                    setForm({ ...form, socle_organization_id: val === NO_ORG_VALUE ? null : val })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="— Aucune —" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_ORG_VALUE}>— Aucune —</SelectItem>
                    {orgOptions.map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        {"  ".repeat(o.depth - 1)}
                        {o.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Les courriers reçus sur cette boîte seront rattachés à cette organisation.
                </p>
              </div>
            )}

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

            <div className="rounded-lg border p-3 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm font-medium">Boîte de numérisation</Label>
                  <p className="text-xs text-muted-foreground">
                    Alimentée par un copieur : les documents deviennent des courriers papier,
                    océrisés et pré-qualifiés automatiquement
                  </p>
                </div>
                <Switch
                  checked={form.is_scan_inbox}
                  onCheckedChange={(val) => setForm({ ...form, is_scan_inbox: val })}
                />
              </div>

              {form.is_scan_inbox && (
                <>
                  <div className="space-y-1.5">
                    <Label className="text-sm">Expéditeurs autorisés</Label>
                    <Textarea
                      rows={2}
                      placeholder="copieur-accueil@ville.fr, copieur-etage2@ville.fr"
                      defaultValue={form.scan_allowed_senders?.join(", ") ?? ""}
                      onBlur={(e) =>
                        setForm({ ...form, scan_allowed_senders: parseAllowedSenders(e.target.value) })
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      Adresses des copieurs, séparées par des virgules. Laisser vide accepte
                      n'importe quel expéditeur : toute personne connaissant l'adresse de la
                      boîte pourrait alors créer des courriers.
                    </p>
                  </div>

                  <p className="text-xs text-muted-foreground border-t pt-2">
                    <strong className="font-medium text-foreground">Réglages du copieur :</strong>{" "}
                    format PDF (pas TIFF), 200 à 300 dpi, niveaux de gris, et si possible
                    « un fichier par document » pour éviter d'avoir à découper les lots.
                  </p>
                </>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Annuler
              </Button>
              <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                {saveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Enregistrer
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
