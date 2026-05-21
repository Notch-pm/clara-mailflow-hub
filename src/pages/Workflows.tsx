import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { GitBranch, Plus, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
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
import { useToast } from "@/hooks/use-toast";
import { useOrganization } from "@/contexts/OrganizationContext";
import { getWorkflows, createWorkflow, deleteWorkflow, updateWorkflow, type WorkflowType } from "@/services/workflowService";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Workflow, WorkflowState } from "@/types/courier";

export default function Workflows() {
  const navigate = useNavigate();
  const { organizationId } = useOrganization();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<WorkflowType | "">("");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data: workflows, isLoading } = useQuery({
    queryKey: ["workflows", organizationId],
    queryFn: async () => {
      if (!organizationId) return [];
      const { data, error } = await getWorkflows(organizationId);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!organizationId,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("Pas d'organisation");
      if (!newType) throw new Error("Type requis");
      const { error } = await createWorkflow(organizationId, newName.trim(), newType);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workflows"] });
      setCreateOpen(false);
      setNewName("");
      setNewType("");
      toast({ title: "Workflow créé" });
    },
    onError: (err: any) => toast({ title: "Erreur", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await deleteWorkflow(id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workflows"] });
      setDeleteId(null);
      toast({ title: "Workflow supprimé" });
    },
    onError: (err: any) => toast({ title: "Erreur", description: err.message, variant: "destructive" }),
  });

  const updateTypeMutation = useMutation({
    mutationFn: async ({ id, type }: { id: string; type: WorkflowType }) => {
      const { error } = await updateWorkflow(id, { type });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workflows"] });
      toast({ title: "Type mis à jour" });
    },
    onError: (err: any) => toast({ title: "Erreur", description: err.message, variant: "destructive" }),
  });
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <GitBranch className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Workflows</h1>
            <p className="text-muted-foreground">Visualisation et gestion des processus de traitement</p>
          </div>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Nouveau workflow
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : !workflows?.length ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Aucun workflow configuré. Créez-en un pour commencer.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {workflows.map((wf: any) => {
            const states = (wf.workflow_states ?? []) as WorkflowState[];
            return (
              <Card
                key={wf.id}
                className="cursor-pointer hover:shadow-lg transition-shadow"
                onClick={() => navigate(`/workflows/${wf.id}`)}
              >
                <CardHeader className="flex flex-row items-start justify-between pb-2">
                  <div className="space-y-2 flex-1 min-w-0">
                    <CardTitle className="text-base">{wf.name}</CardTitle>
                    <div onClick={(e) => e.stopPropagation()}>
                      <Select
                        value={wf.type ?? "inbound"}
                        onValueChange={(v) => updateTypeMutation.mutate({ id: wf.id, type: v as WorkflowType })}
                      >
                        <SelectTrigger className="h-7 w-[160px] text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="inbound">Courrier reçu</SelectItem>
                          <SelectItem value="reply">Réponse</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {wf.is_default && <Badge variant="secondary">Par défaut</Badge>}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      aria-label="Supprimer le workflow"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteId(wf.id);
                      }}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{states.length} état(s)</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nouveau workflow</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="wf-name">Nom</Label>
              <Input
                id="wf-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Ex: Courrier entrant standard"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="wf-type">Type</Label>
              <Select value={newType} onValueChange={(v) => setNewType(v as WorkflowType)}>
                <SelectTrigger id="wf-type">
                  <SelectValue placeholder="Sélectionner un type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="inbound">Courrier reçu</SelectItem>
                  <SelectItem value="reply">Réponse</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={!newName.trim() || !newType || createMutation.isPending}
            >
              Créer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer ce workflow ?</AlertDialogTitle>
            <AlertDialogDescription>
              Cette action supprimera tous les états et transitions associés.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteId && deleteMutation.mutate(deleteId)}>
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
