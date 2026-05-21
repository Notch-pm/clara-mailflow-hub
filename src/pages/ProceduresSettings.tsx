import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import {
  listProcedures,
  updateProcedure,
  deleteProcedure,
  type Procedure,
} from "@/services/procedureService";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { Plus, Pencil, Trash2, FileText, Search, Import } from "lucide-react";
import { toast } from "sonner";
import { ProcedureFormDialog } from "@/components/ProcedureFormDialog";

interface Props {
  organizationId?: string;
  isAdminOverride?: boolean;
}

function isUrl(v: string | null | undefined): boolean {
  return !!v && (v.startsWith("http://") || v.startsWith("https://"));
}

export default function ProceduresSettings({ organizationId, isAdminOverride }: Props) {
  const { membership, profile } = useAuth();
  const queryClient = useQueryClient();

  const orgId = organizationId ?? membership?.organization_id ?? "";
  const isAdmin =
    isAdminOverride ?? (membership?.role === "administrateur" || !!profile?.is_superadmin);

  const [search, setSearch] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editing, setEditing] = useState<Procedure | null>(null);
  const [deleting, setDeleting] = useState<Procedure | null>(null);

  const { data: procedures = [], isLoading } = useQuery({
    queryKey: ["procedures", orgId],
    queryFn: () => listProcedures(orgId!),
    enabled: !!orgId,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<Procedure> }) =>
      updateProcedure(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["procedures", orgId] });
    },
    onError: (e: Error) => toast.error("Erreur : " + e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteProcedure(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["procedures", orgId] });
      toast.success("Démarche supprimée");
      setDeleteOpen(false);
      setDeleting(null);
    },
    onError: (e: Error) => toast.error("Erreur : " + e.message),
  });

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(p: Procedure) {
    setEditing(p);
    setDialogOpen(true);
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return procedures.filter(
      (p) =>
        !q ||
        p.name.toLowerCase().includes(q) ||
        (p.description ?? "").toLowerCase().includes(q),
    );
  }, [procedures, search]);

  const visible = filtered.filter((p) => p.is_displayed);
  const hidden = filtered.filter((p) => !p.is_displayed);

  if (!orgId) {
    return <p className="text-sm text-muted-foreground">Aucune organisation sélectionnée.</p>;
  }

  if (isLoading) return <Skeleton className="h-48 w-full" />;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Démarches</h2>
          <p className="text-muted-foreground text-sm">
            Liste des démarches administratives proposées par l'organisation.
          </p>
        </div>
        {isAdmin && (
          <Button onClick={openCreate} className="gap-2">
            <Plus className="h-4 w-4" />
            Ajouter une démarche
          </Button>
        )}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <CardTitle className="text-lg">
              Liste des démarches
              {procedures.length > 0 && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  ({visible.length} visible{visible.length > 1 ? "s" : ""}
                  {hidden.length > 0 ? ` · ${hidden.length} masquée${hidden.length > 1 ? "s" : ""}` : ""})
                </span>
              )}
            </CardTitle>
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Rechercher une démarche..."
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-muted-foreground gap-2">
              <FileText className="h-8 w-8" />
              <p>{search ? "Aucun résultat" : "Aucune démarche configurée"}</p>
            </div>
          ) : (
            <div className="space-y-6">
              {visible.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Démarche</TableHead>
                      <TableHead className="w-24 text-center">Visible</TableHead>
                      {isAdmin && <TableHead className="w-28 text-right">Actions</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visible.map((p) => (
                      <ProcedureRow
                        key={p.id}
                        procedure={p}
                        isAdmin={!!isAdmin}
                        onEdit={openEdit}
                        onDelete={(proc) => {
                          setDeleting(proc);
                          setDeleteOpen(true);
                        }}
                        onToggle={(proc, val) =>
                          updateMutation.mutate({ id: proc.id, payload: { is_displayed: val } })
                        }
                      />
                    ))}
                  </TableBody>
                </Table>
              )}

              {hidden.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center gap-3 pt-2 border-t border-border/50">
                    <Switch checked={showHidden} onCheckedChange={setShowHidden} />
                    <Label
                      className="text-sm text-muted-foreground cursor-pointer"
                      onClick={() => setShowHidden(!showHidden)}
                    >
                      Afficher les démarches masquées ({hidden.length})
                    </Label>
                  </div>
                  {showHidden && (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Démarche</TableHead>
                          <TableHead className="w-24 text-center">Visible</TableHead>
                          {isAdmin && <TableHead className="w-28 text-right">Actions</TableHead>}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {hidden.map((p) => (
                          <ProcedureRow
                            key={p.id}
                            procedure={p}
                            isAdmin={!!isAdmin}
                            faded
                            onEdit={openEdit}
                            onDelete={(proc) => {
                              setDeleting(proc);
                              setDeleteOpen(true);
                            }}
                            onToggle={(proc, val) =>
                              updateMutation.mutate({
                                id: proc.id,
                                payload: { is_displayed: val },
                              })
                            }
                          />
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <ProcedureFormDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditing(null);
        }}
        orgId={orgId}
        procedure={editing}
      />

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer cette démarche ?</AlertDialogTitle>
            <AlertDialogDescription>
              Cette action est irréversible. La démarche « {deleting?.name} » sera définitivement supprimée.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleting && deleteMutation.mutate(deleting.id)}
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

function ProcedureRow({
  procedure,
  isAdmin,
  faded,
  onEdit,
  onDelete,
  onToggle,
}: {
  procedure: Procedure;
  isAdmin: boolean;
  faded?: boolean;
  onEdit: (p: Procedure) => void;
  onDelete: (p: Procedure) => void;
  onToggle: (p: Procedure, val: boolean) => void;
}) {
  return (
    <TableRow className={faded ? "opacity-60" : ""}>
      <TableCell>
        <div className="flex items-center gap-3">
          {isUrl(procedure.icon) ? (
            <img
              src={procedure.icon!}
              alt={procedure.name}
              className="h-9 w-9 shrink-0 rounded-lg object-cover"
            />
          ) : (
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white text-sm font-semibold"
              style={{ backgroundColor: procedure.color || "#0acf83" }}
            >
              {procedure.name.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-medium truncate">{procedure.name}</span>
              {procedure.external_source && (
                <Badge variant="secondary" className="text-[10px] gap-1 px-1.5 py-0 h-5 shrink-0">
                  <Import className="h-3 w-3" />
                  {procedure.external_source === "arpege" ? "Arpège" : procedure.external_source}
                </Badge>
              )}
            </div>
            {procedure.description && (
              <p className="text-xs text-muted-foreground line-clamp-1">{procedure.description}</p>
            )}
          </div>
        </div>
      </TableCell>
      <TableCell className="text-center">
        <Switch
          checked={procedure.is_displayed}
          onCheckedChange={(val) => onToggle(procedure, val)}
          disabled={!isAdmin}
        />
      </TableCell>
      {isAdmin && (
        <TableCell className="text-right">
          <div className="flex justify-end gap-1">
            <Button variant="ghost" size="icon" onClick={() => onEdit(procedure)} title="Modifier" aria-label="Modifier la démarche">
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onDelete(procedure)}
              title="Supprimer"
              aria-label="Supprimer la démarche"
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </TableCell>
      )}
    </TableRow>
  );
}
