import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { Plus, Pencil, Trash2, Briefcase, Mail, GitBranch } from "lucide-react";
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

const serviceSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Le libellé est obligatoire")
    .max(100, "100 caractères maximum"),
  email: z
    .string()
    .trim()
    .max(255, "255 caractères maximum")
    .email("Adresse email invalide")
    .optional()
    .or(z.literal("")),
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
        .select("id, name")
        .eq("organization_id", orgId)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!orgId,
  });

  const saveMutation = useMutation({
    mutationFn: async (values: z.infer<typeof serviceSchema>) => {
      const payload = {
        name: values.name,
        email: values.email || null,
        workflow_id: values.workflow_id,
      };
      return editing
        ? updateService(editing.id, payload)
        : createService(orgId, payload);
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
                    <TableHead>Courriel</TableHead>
                    <TableHead>Workflow</TableHead>
                    {isAdmin && <TableHead className="w-[100px] text-right">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {services.map((svc) => (
                    <TableRow key={svc.id}>
                      <TableCell className="font-medium">{svc.name}</TableCell>
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
  onSubmit,
  isSubmitting,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editing: OrgService | null;
  workflows: { id: string; name: string }[];
  onSubmit: (values: z.infer<typeof serviceSchema>) => void;
  isSubmitting: boolean;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [workflowId, setWorkflowId] = useState<string>("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const editingId = editing?.id ?? null;
  const lastInitRef = useRefEqual({ open, editingId });
  if (lastInitRef.changed) {
    setName(editing?.name ?? "");
    setEmail(editing?.email ?? "");
    setWorkflowId(editing?.workflow_id ?? "");
    setErrors({});
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const result = serviceSchema.safeParse({ name, email, workflow_id: workflowId });
    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      result.error.issues.forEach((i) => {
        if (i.path[0]) fieldErrors[i.path[0] as string] = i.message;
      });
      setErrors(fieldErrors);
      return;
    }
    setErrors({});
    onSubmit(result.data);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Modifier le service" : "Nouveau service"}</DialogTitle>
          <DialogDescription>
            Le libellé et le workflow sont obligatoires.
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

function useRefEqual<T extends Record<string, unknown>>(value: T) {
  const ref = useRef<T | null>(null);
  const prev = ref.current;
  const changed =
    !prev || Object.keys(value).some((k) => (value as any)[k] !== (prev as any)[k]);
  if (changed) ref.current = { ...value };
  return { changed };
}
