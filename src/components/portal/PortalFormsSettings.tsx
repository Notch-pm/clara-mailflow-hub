import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Copy, Globe, ToggleLeft, ToggleRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/contexts/AuthContext";
import { listServices } from "@/services/orgServiceService";
import {
  getPortalForms,
  createPortalForm,
  updatePortalForm,
  deletePortalForm,
  type PortalForm,
} from "@/services/portalFormService";

export default function PortalFormsSettings() {
  const { membership } = useAuth();
  const orgId = membership?.organization_id ?? "";
  const isAdmin = membership?.role === "admin" || membership?.role === "administrateur";

  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PortalForm | null>(null);

  const [formName, setFormName] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formServiceId, setFormServiceId] = useState<string>("");
  const [formOrigins, setFormOrigins] = useState("");

  const { data: forms, isLoading } = useQuery({
    queryKey: ["portal-forms", orgId],
    queryFn: () => getPortalForms(orgId),
    enabled: !!orgId,
  });

  const { data: services } = useQuery({
    queryKey: ["services", orgId],
    queryFn: () => listServices(orgId),
    enabled: !!orgId,
  });

  const createMutation = useMutation({
    mutationFn: () =>
      createPortalForm({
        organization_id: orgId,
        name: formName.trim(),
        description: formDesc.trim() || null,
        service_id: formServiceId || null,
        allowed_origins: formOrigins.trim()
          ? formOrigins.split("\n").map((l) => l.trim()).filter(Boolean)
          : null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portal-forms", orgId] });
      toast.success("Formulaire créé");
      resetDialog();
    },
    onError: () => toast.error("Impossible de créer le formulaire"),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      updatePortalForm(orgId, id, { is_active }),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["portal-forms", orgId] });
      toast.success(vars.is_active ? "Formulaire activé" : "Formulaire désactivé");
    },
    onError: () => toast.error("Impossible de modifier le formulaire"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deletePortalForm(orgId, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portal-forms", orgId] });
      toast.success("Formulaire supprimé");
      setDeleteTarget(null);
    },
    onError: () => toast.error("Impossible de supprimer le formulaire"),
  });

  function resetDialog() {
    setDialogOpen(false);
    setFormName("");
    setFormDesc("");
    setFormServiceId("");
    setFormOrigins("");
  }

  function copyIframeUrl(token: string) {
    const url = `${window.location.origin}/portail/${token}`;
    void navigator.clipboard.writeText(
      `<iframe src="${url}" width="100%" height="600" frameborder="0" title="Formulaire de contact"></iframe>`,
    );
    toast.success("Code iframe copié dans le presse-papier");
  }

  function copyFormUrl(token: string) {
    const url = `${window.location.origin}/portail/${token}`;
    void navigator.clipboard.writeText(url);
    toast.success("URL copiée dans le presse-papier");
  }

  const formList = (forms as any)?.data as PortalForm[] | null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Formulaires portail citoyen</h2>
          <p className="text-sm text-muted-foreground">
            Intégrez un formulaire de contact sur votre site web via une balise{" "}
            <code className="text-xs bg-muted px-1 py-0.5 rounded">&lt;iframe&gt;</code>. Chaque
            soumission crée un courrier entrant dans la boîte aux lettres Clara.
          </p>
        </div>
        {isAdmin && (
          <Button onClick={() => setDialogOpen(true)} size="sm">
            <Plus className="h-4 w-4 mr-1.5" />
            Nouveau formulaire
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <Skeleton key={i} className="h-24 w-full rounded-lg" />
          ))}
        </div>
      ) : !formList?.length ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <Globe className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">Aucun formulaire portail configuré.</p>
            {isAdmin && (
              <Button variant="outline" size="sm" onClick={() => setDialogOpen(true)}>
                <Plus className="h-4 w-4 mr-1.5" />
                Créer le premier formulaire
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {formList.map((form) => (
            <Card key={form.id}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <CardTitle className="text-base">{form.name}</CardTitle>
                      <Badge variant={form.is_active ? "default" : "secondary"}>
                        {form.is_active ? "Actif" : "Inactif"}
                      </Badge>
                      {form.service_id && services?.find((s) => s.id === form.service_id)?.name && (
                        <Badge variant="outline" className="text-xs">
                          {services.find((s) => s.id === form.service_id)!.name}
                        </Badge>
                      )}
                    </div>
                    {form.description && (
                      <CardDescription className="text-xs">{form.description}</CardDescription>
                    )}
                    <p className="text-xs text-muted-foreground font-mono truncate max-w-xs">
                      {window.location.origin}/portail/{form.token}
                    </p>
                  </div>
                  {isAdmin && (
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Copier l'URL"
                        onClick={() => copyFormUrl(form.token)}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Copier le code iframe"
                        onClick={() => copyIframeUrl(form.token)}
                      >
                        <Globe className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title={form.is_active ? "Désactiver" : "Activer"}
                        onClick={() => toggleMutation.mutate({ id: form.id, is_active: !form.is_active })}
                        disabled={toggleMutation.isPending}
                      >
                        {form.is_active ? (
                          <ToggleRight className="h-4 w-4 text-primary" />
                        ) : (
                          <ToggleLeft className="h-4 w-4 text-muted-foreground" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Supprimer"
                        onClick={() => setDeleteTarget(form)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  )}
                </div>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}

      {/* Dialog création */}
      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) resetDialog(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Nouveau formulaire portail</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="pf-name">Nom du formulaire <span aria-hidden>*</span></Label>
              <Input
                id="pf-name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="Formulaire de contact site web"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pf-desc">
                Description <span className="text-muted-foreground text-xs">(affichée aux citoyens)</span>
              </Label>
              <Textarea
                id="pf-desc"
                value={formDesc}
                onChange={(e) => setFormDesc(e.target.value)}
                placeholder="Utilisez ce formulaire pour nous contacter…"
                rows={2}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pf-service">
                Service destinataire <span className="text-muted-foreground text-xs">(optionnel)</span>
              </Label>
              <Select value={formServiceId || "none"} onValueChange={(v) => setFormServiceId(v === "none" ? "" : v)}>
                <SelectTrigger id="pf-service">
                  <SelectValue placeholder="Aucun service spécifique" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Aucun service spécifique</SelectItem>
                  {services?.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pf-origins">
                Origines autorisées{" "}
                <span className="text-muted-foreground text-xs">(optionnel — une URL par ligne)</span>
              </Label>
              <Textarea
                id="pf-origins"
                value={formOrigins}
                onChange={(e) => setFormOrigins(e.target.value)}
                placeholder={"https://www.mairie-exemple.fr\nhttps://www.autre-site.fr"}
                rows={2}
                className="font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">
                Si vide, le formulaire peut être intégré depuis n'importe quel site.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={resetDialog}>
              Annuler
            </Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={!formName.trim() || createMutation.isPending}
            >
              {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Créer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmation suppression */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer ce formulaire ?</AlertDialogTitle>
            <AlertDialogDescription>
              Le formulaire «{deleteTarget?.name}» sera définitivement supprimé. Les intégrations
              iframe existantes cesseront de fonctionner.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
