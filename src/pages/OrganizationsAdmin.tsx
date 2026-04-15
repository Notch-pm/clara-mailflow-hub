import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Pencil, Trash2, Building2, Settings } from "lucide-react";
import { toast } from "sonner";

interface OrgRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  logo_url: string | null;
  primary_color: string | null;
  secondary_color: string | null;
}

interface OrgForm {
  name: string;
  slug: string;
  logo_url: string;
  primary_color: string;
  secondary_color: string;
}

const emptyForm: OrgForm = { name: "", slug: "", logo_url: "", primary_color: "", secondary_color: "" };

export default function OrganizationsAdmin() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingOrg, setEditingOrg] = useState<OrgRow | null>(null);
  const [form, setForm] = useState<OrgForm>(emptyForm);
  const [deleteConfirm, setDeleteConfirm] = useState<OrgRow | null>(null);

  const { data: organizations, isLoading } = useQuery({
    queryKey: ["superadmin-organizations"],
    queryFn: async () => {
      const { data, error } = await supabase.from("organizations").select("*").order("name");
      if (error) throw error;
      return data as OrgRow[];
    },
  });

  const upsertMutation = useMutation({
    mutationFn: async (values: OrgForm & { id?: string }) => {
      if (values.id) {
        const { error } = await supabase.from("organizations").update({
          name: values.name,
          slug: values.slug,
          logo_url: values.logo_url || null,
          primary_color: values.primary_color || null,
          secondary_color: values.secondary_color || null,
        } as any).eq("id", values.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("organizations").insert({
          name: values.name,
          slug: values.slug || values.name.toLowerCase().replace(/\s+/g, "-"),
          logo_url: values.logo_url || null,
          primary_color: values.primary_color || null,
          secondary_color: values.secondary_color || null,
        } as any);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["superadmin-organizations"] });
      toast.success(editingOrg ? "Organisation mise à jour" : "Organisation créée");
      closeDialog();
    },
    onError: (e) => toast.error("Erreur : " + e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("organizations").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["superadmin-organizations"] });
      toast.success("Organisation supprimée");
      setDeleteConfirm(null);
    },
    onError: (e) => toast.error("Erreur : " + e.message),
  });

  function openCreate() {
    setEditingOrg(null);
    setForm(emptyForm);
    setDialogOpen(true);
  }

  function openEdit(org: OrgRow) {
    setEditingOrg(org);
    setForm({
      name: org.name,
      slug: org.slug,
      logo_url: org.logo_url || "",
      primary_color: org.primary_color || "",
      secondary_color: org.secondary_color || "",
    });
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setEditingOrg(null);
    setForm(emptyForm);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    upsertMutation.mutate({ ...form, id: editingOrg?.id });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Organisations</h1>
          <p className="text-muted-foreground">Gestion des organisations de la plateforme</p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-2" /> Nouvelle organisation
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nom</TableHead>
                <TableHead>Couleurs</TableHead>
                <TableHead className="w-36">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-center py-8 text-muted-foreground">Chargement…</TableCell>
                </TableRow>
              ) : !organizations?.length ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-center py-8 text-muted-foreground">Aucune organisation</TableCell>
                </TableRow>
              ) : (
                organizations.map((org) => (
                  <TableRow key={org.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        {org.logo_url ? (
                          <img src={org.logo_url} alt={org.name} className="h-8 w-8 rounded object-contain" />
                        ) : (
                          <Building2 className="h-5 w-5 text-muted-foreground" />
                        )}
                        {org.name}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {org.primary_color && (
                          <div className="h-4 w-4 rounded-full border" style={{ backgroundColor: org.primary_color }} title="Primaire" />
                        )}
                        {org.secondary_color && (
                          <div className="h-4 w-4 rounded-full border" style={{ backgroundColor: org.secondary_color }} title="Secondaire" />
                        )}
                        {!org.primary_color && !org.secondary_color && (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="outline" size="sm" onClick={() => navigate(`/superadmin/organisations/${org.id}`)}>
                          <Settings className="h-4 w-4 mr-1" /> Paramétrer
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => openEdit(org)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => setDeleteConfirm(org)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={(o) => !o && closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingOrg ? "Modifier l'organisation" : "Nouvelle organisation"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>Nom *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div className="space-y-2">
              <Label>Slug</Label>
              <Input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} placeholder="mon-organisation" />
            </div>
            <div className="space-y-2">
              <Label>URL du logo</Label>
              <Input value={form.logo_url} onChange={(e) => setForm({ ...form, logo_url: e.target.value })} placeholder="https://..." />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Couleur principale</Label>
                <div className="flex gap-2">
                  <Input value={form.primary_color} onChange={(e) => setForm({ ...form, primary_color: e.target.value })} placeholder="#3B82F6" className="flex-1" />
                  {form.primary_color && <div className="h-9 w-9 rounded border shrink-0" style={{ backgroundColor: form.primary_color }} />}
                </div>
              </div>
              <div className="space-y-2">
                <Label>Couleur secondaire</Label>
                <div className="flex gap-2">
                  <Input value={form.secondary_color} onChange={(e) => setForm({ ...form, secondary_color: e.target.value })} placeholder="#10B981" className="flex-1" />
                  {form.secondary_color && <div className="h-9 w-9 rounded border shrink-0" style={{ backgroundColor: form.secondary_color }} />}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeDialog}>Annuler</Button>
              <Button type="submit" disabled={upsertMutation.isPending}>
                {editingOrg ? "Enregistrer" : "Créer"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteConfirm} onOpenChange={(o) => !o && setDeleteConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Supprimer « {deleteConfirm?.name} » ?</DialogTitle>
          </DialogHeader>
          <p className="text-muted-foreground">Cette action est irréversible. Toutes les données associées seront supprimées.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>Annuler</Button>
            <Button variant="destructive" onClick={() => deleteConfirm && deleteMutation.mutate(deleteConfirm.id)} disabled={deleteMutation.isPending}>
              Supprimer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
