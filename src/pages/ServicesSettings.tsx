import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { Plus, Pencil, Trash2, Briefcase, Mail, GitBranch, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  listServices,
  createService,
  updateService,
  deleteService,
  type OrgService,
} from "@/services/orgServiceService";

interface ImapConfig {
  id: string;
  label: string;
  username: string;
}

const baseSchema = z.object({
  name: z.string().trim().min(1, "Le libellé est obligatoire").max(100, "100 caractères maximum"),
  workflow_id: z.string().uuid("Workflow obligatoire"),
});

interface Props {
  organizationId?: string;
  isAdminOverride?: boolean;
}

export default function ServicesSettings({ organizationId, isAdminOverride }: Props) {
  const { membership } = useAuth();
  const orgId = organizationId ?? membership?.organization_id ?? "";
  const isAdmin = isAdminOverride ?? membership?.role === "administrateur";

  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<OrgService | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<OrgService | null>(null);

  const { data: services, isLoading } = useQuery({
    queryKey: ["org-services", orgId],
    queryFn: () => listServices(orgId),
    enabled: !!orgId,
  });

  const { data: workflows } = useQuery({
    queryKey: ["org-workflows-list", orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("workflows")
        .select("id, name, type")
        .eq("organization_id", orgId)
        .order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string; type: "inbound" | "reply" | null }[];
    },
    enabled: !!orgId,
  });

  const inboundWorkflows = (workflows ?? []).filter((w) => (w.type ?? "inbound") === "inbound");
  const replyWorkflows = (workflows ?? []).filter((w) => w.type === "reply");

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

  const { data: imapConfigs = [] } = useQuery({
    queryKey: ["imap-settings", orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("imap_settings" as never)
        .select("id, label, username")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ImapConfig[];
    },
    enabled: !!orgId && (org?.multiple_imap ?? false),
  });

  const multipleImap = org?.multiple_imap ?? false;

  const saveMutation = useMutation({
    mutationFn: async (values: {
      name: string;
      email: string | null;
      workflow_id: string;
      imap_settings_id: string | null;
    }) => {
      return editing
        ? updateService(editing.id, values)
        : createService(orgId, values);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["org-services", orgId] });
      toast.success(editing ? "Service modifié" : "Service créé");
      setDialogOpen(false);
      setEditing(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteService(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["org-services", orgId] });
      toast.success("Service supprimé");
      setDeleteTarget(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
  }
  function openEdit(svc: OrgService) {
    setEditing(svc);
    setDialogOpen(true);
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <Briefcase className="h-5 w-5 text-primary" />
              </div>
              <div>
                <CardTitle>Services</CardTitle>
                <CardDescription>
                  Définissez les services de l'organisation et leur workflow associé.
                </CardDescription>
              </div>
            </div>
            {isAdmin && (
              <Button onClick={openCreate} disabled={!workflows?.length}>
                <Plus className="h-4 w-4 mr-1" />
                Nouveau service
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {!isAdmin && (
            <Alert>
              <AlertDescription>
                Seuls les administrateurs peuvent gérer les services.
              </AlertDescription>
            </Alert>
          )}
          {isAdmin && workflows && workflows.length === 0 && (
            <Alert>
              <AlertDescription>
                Créez d'abord un workflow avant d'ajouter des services.
              </AlertDescription>
            </Alert>
          )}

          {isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : services && services.length > 0 ? (
            <div className="rounded-lg border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Libellé</TableHead>
                    {!multipleImap && <TableHead>Courriel</TableHead>}
                    {multipleImap && <TableHead>Email (IMAP)</TableHead>}
                    <TableHead>Workflow</TableHead>
                    {isAdmin && <TableHead className="w-[100px] text-right">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {services.map((svc) => (
                    <TableRow key={svc.id}>
                      <TableCell className="font-medium">{svc.name}</TableCell>
                      {!multipleImap && (
                        <TableCell className="text-muted-foreground text-sm">
                          {svc.email ? (
                            <span className="inline-flex items-center gap-1.5">
                              <Mail className="h-3.5 w-3.5" />
                              {svc.email}
                            </span>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                      )}
                      {multipleImap && (
                        <TableCell className="text-muted-foreground text-sm">
                          {svc.imap_config ? (
                            <span className="inline-flex items-center gap-1.5">
                              <Inbox className="h-3.5 w-3.5" />
                              {svc.imap_config.username}
                              {svc.imap_config.label && (
                                <span className="text-xs text-muted-foreground">
                                  ({svc.imap_config.label})
                                </span>
                              )}
                            </span>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                      )}
                      <TableCell className="text-sm">
                        <span className="inline-flex items-center gap-1.5">
                          <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
                          {svc.workflow?.name ?? "—"}
                        </span>
                      </TableCell>
                      {isAdmin && (
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => openEdit(svc)}
                              aria-label="Modifier"
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => setDeleteTarget(svc)}
                              aria-label="Supprimer"
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Aucun service défini.</p>
          )}
        </CardContent>
      </Card>

      <ServiceDialog
        open={dialogOpen}
        onOpenChange={(o) => {
          setDialogOpen(o);
          if (!o) setEditing(null);
        }}
        editing={editing}
        workflows={workflows ?? []}
        imapConfigs={imapConfigs}
        multipleImap={multipleImap}
        onSubmit={(values) => saveMutation.mutate(values)}
        isSubmitting={saveMutation.isPending}
      />

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer le service ?</AlertDialogTitle>
            <AlertDialogDescription>
              Le service « {deleteTarget?.name} » sera supprimé définitivement.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ServiceDialog({
  open,
  onOpenChange,
  editing,
  workflows,
  imapConfigs,
  multipleImap,
  onSubmit,
  isSubmitting,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editing: OrgService | null;
  workflows: { id: string; name: string }[];
  imapConfigs: ImapConfig[];
  multipleImap: boolean;
  onSubmit: (values: {
    name: string;
    email: string | null;
    workflow_id: string;
    imap_settings_id: string | null;
  }) => void;
  isSubmitting: boolean;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [workflowId, setWorkflowId] = useState<string>("");
  const [imapSettingsId, setImapSettingsId] = useState<string>("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setName(editing?.name ?? "");
    setEmail(editing?.email ?? "");
    setWorkflowId(editing?.workflow_id ?? "");
    setImapSettingsId(editing?.imap_settings_id ?? "");
    setErrors({});
  }, [open, editing?.id, editing?.name, editing?.email, editing?.workflow_id, editing?.imap_settings_id]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const base = baseSchema.safeParse({ name, workflow_id: workflowId });
    const fieldErrors: Record<string, string> = {};

    if (!base.success) {
      base.error.issues.forEach((i) => {
        if (i.path[0]) fieldErrors[i.path[0] as string] = i.message;
      });
    }

    if (multipleImap && !imapSettingsId) {
      fieldErrors.imap_settings_id = "La boîte IMAP est obligatoire";
    }

    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      return;
    }

    setErrors({});
    onSubmit({
      name: name.trim(),
      email: multipleImap ? null : email.trim() || null,
      workflow_id: workflowId,
      imap_settings_id: multipleImap ? imapSettingsId || null : null,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Modifier le service" : "Nouveau service"}</DialogTitle>
          <DialogDescription>
            Le libellé{multipleImap ? ", la boîte IMAP" : ""} et le workflow sont obligatoires.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="svc-name">Libellé *</Label>
            <Input
              id="svc-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              placeholder="Ex. Direction Générale"
              autoFocus
            />
            {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
          </div>

          {multipleImap ? (
            <div className="space-y-2">
              <Label htmlFor="svc-imap">Boîte IMAP *</Label>
              <Select value={imapSettingsId} onValueChange={setImapSettingsId}>
                <SelectTrigger id="svc-imap">
                  <SelectValue placeholder="Sélectionner une boîte IMAP" />
                </SelectTrigger>
                <SelectContent>
                  {imapConfigs.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.label ? `${c.label} — ${c.username}` : c.username}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.imap_settings_id && (
                <p className="text-xs text-destructive">{errors.imap_settings_id}</p>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="svc-email">Courriel</Label>
              <Input
                id="svc-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                maxLength={255}
                placeholder="service@exemple.fr (facultatif)"
              />
              {errors.email && <p className="text-xs text-destructive">{errors.email}</p>}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="svc-workflow">Workflow associé *</Label>
            <Select value={workflowId} onValueChange={setWorkflowId}>
              <SelectTrigger id="svc-workflow">
                <SelectValue placeholder="Sélectionner un workflow" />
              </SelectTrigger>
              <SelectContent>
                {workflows.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.workflow_id && (
              <p className="text-xs text-destructive">{errors.workflow_id}</p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {editing ? "Enregistrer" : "Créer"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
