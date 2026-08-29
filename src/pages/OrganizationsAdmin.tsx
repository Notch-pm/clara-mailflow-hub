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
import { Pencil, Trash2, Building2, Settings, RefreshCw, Landmark, Download } from "lucide-react";
import { toast } from "sonner";
import {
  triggerSocleSync,
  listSocleOrganizations,
  type SocleSyncResult,
  type SocleSyncCounters,
  type SocleOrganization,
} from "@/services/socleSyncService";

interface OrgRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  logo_url: string | null;
  primary_color: string | null;
  secondary_color: string | null;
  socle_org_id: string | null;
}

/** Compteurs par entité miroir (les autres champs sont des nombres ou des avertissements). */
type SocleEntityKey = "organizations" | "categories" | "document_types" | "procedures";

const syncCounterLabels: { key: SocleEntityKey; label: string }[] = [
  { key: "organizations", label: "Organisations" },
  { key: "categories", label: "Catégories" },
  { key: "document_types", label: "Types de documents" },
  { key: "procedures", label: "Démarches" },
];

/** Résumé chiffré d'une synchronisation d'une organisation (toast de succès). */
function syncSummary(result: SocleSyncResult): string {
  const counters = result.results?.[0]?.counters;
  if (!counters) return result.message;
  const parts = syncCounterLabels.map(({ key, label }) => {
    const c = counters[key];
    return `${label} : ${c.created + c.updated + c.adopted + c.obsoleted}`;
  });
  // Le serveur d'envoi vient du référentiel : dire ce qu'il en est évite de
  // chercher pourquoi les mails partent (ou ne partent plus).
  if (counters.smtp_synchronises) parts.push("Serveur d'envoi : à jour");
  else if (counters.smtp_retires) parts.push("Serveur d'envoi : retiré (aucun dans le référentiel)");
  const resume = `Éléments modifiés — ${parts.join(", ")}.`;
  return counters.warnings?.length ? `${resume} ⚠️ ${counters.warnings.join(" ")}` : resume;
}

// Miroirs Socle rafraîchis après une synchronisation manuelle.
const SOCLE_QUERY_KEYS = [
  "superadmin-organizations",
  "socle-organizations",
  "socle-orgs-config",
  "socle-categories",
  "socle-last-sync",
  "procedures",
  "procedures-displayed",
];

// Une organisation Clara naît uniquement par IMPORT d'une organisation
// principale du référentiel (plus de création locale). Nom, slug et logo sont
// fixés par la racine du Socle (sync) : seules les couleurs s'éditent ici.
interface OrgForm {
  primary_color: string;
  secondary_color: string;
}

const emptyForm: OrgForm = { primary_color: "", secondary_color: "" };

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
    mutationFn: async (values: OrgForm & { id: string }) => {
      const { error } = await supabase.from("organizations").update({
        primary_color: values.primary_color || null,
        secondary_color: values.secondary_color || null,
      }).eq("id", values.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["superadmin-organizations"] });
      toast.success("Organisation mise à jour");
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

  // Synchronisation manuelle d'UNE organisation (sans attendre le cron nocturne).
  const syncMutation = useMutation({
    mutationFn: (orgId: string) => triggerSocleSync(orgId),
    onSuccess: (result) => {
      const orgResult = result.results?.[0];
      if (orgResult?.status === "error") {
        toast.error("Échec de la synchronisation : " + (orgResult.error ?? "erreur inconnue"));
        return;
      }
      toast.success("Synchronisation terminée", { description: syncSummary(result) });
      for (const key of SOCLE_QUERY_KEYS) queryClient.invalidateQueries({ queryKey: [key] });
    },
    onError: (e: Error) => toast.error("Échec de la synchronisation : " + e.message),
  });

  // Détection d'organisations du référentiel pas encore présentes dans Clara.
  const [importOpen, setImportOpen] = useState(false);
  const {
    data: socleOrgs,
    isLoading: socleLoading,
    isError: socleError,
    error: socleErr,
  } = useQuery({
    queryKey: ["socle-organizations"],
    queryFn: listSocleOrganizations,
    enabled: importOpen,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  const importMutation = useMutation({
    mutationFn: async (socleOrg: SocleOrganization) => {
      const { error } = await supabase.from("organizations").insert({
        name: socleOrg.name,
        slug: socleOrg.slug || socleOrg.name.toLowerCase().replace(/\s+/g, "-"),
        socle_org_id: socleOrg.id,
      });
      if (error) throw error;
    },
    onSuccess: (_data, socleOrg) => {
      queryClient.invalidateQueries({ queryKey: ["superadmin-organizations"] });
      toast.success(`« ${socleOrg.name} » importée`, {
        description: "Lancez une synchronisation pour importer ses démarches.",
      });
    },
    onError: (e: Error) => toast.error("Erreur : " + e.message),
  });

  // Un tenant Clara correspond à une organisation PRINCIPALE (racine, sans
  // parent) du référentiel — ses sous-organisations sont miroirées par la sync,
  // pas importées comme tenants. On ne propose donc que les racines pas encore
  // mappées sur une org Clara.
  const importedSocleIds = new Set(
    (organizations ?? []).map((o) => o.socle_org_id).filter((v): v is string => !!v),
  );
  const newSocleOrgs = (socleOrgs ?? []).filter(
    (so) => so.parent_id === null && !importedSocleIds.has(so.id),
  );

  function openEdit(org: OrgRow) {
    setEditingOrg(org);
    setForm({
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
    if (!editingOrg) return;
    upsertMutation.mutate({ ...form, id: editingOrg.id });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Organisations</h1>
          <p className="text-muted-foreground">Gestion des organisations de la plateforme</p>
        </div>
        <Button onClick={() => setImportOpen(true)}>
          <Landmark className="h-4 w-4 mr-2" /> Importer du référentiel
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
                  <TableCell colSpan={3} className="text-center py-8 text-muted-foreground">
                    Aucune organisation — importez-en une depuis le référentiel.
                  </TableCell>
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
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Synchroniser ${org.name}`}
                          title={
                            org.socle_org_id
                              ? "Synchroniser le référentiel de cette organisation"
                              : "Organisation non rattachée au référentiel"
                          }
                          disabled={!org.socle_org_id || syncMutation.isPending}
                          onClick={() => syncMutation.mutate(org.id)}
                        >
                          <RefreshCw
                            className={`h-4 w-4 ${
                              syncMutation.isPending && syncMutation.variables === org.id
                                ? "animate-spin"
                                : ""
                            }`}
                          />
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => navigate(`/superadmin/organisations/${org.id}`)}>
                          <Settings className="h-4 w-4 mr-1" /> Paramétrer
                        </Button>
                        <Button variant="ghost" size="icon" aria-label="Modifier l'organisation" onClick={() => openEdit(org)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" aria-label="Supprimer l'organisation" onClick={() => setDeleteConfirm(org)}>
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
            <DialogTitle>Modifier l'organisation</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            {editingOrg && (
              <div className="flex items-start gap-3 rounded-md border bg-muted/50 p-3">
                {editingOrg.logo_url ? (
                  <img src={editingOrg.logo_url} alt={editingOrg.name} className="h-10 w-10 rounded object-contain shrink-0" />
                ) : (
                  <Building2 className="h-6 w-6 text-muted-foreground shrink-0" />
                )}
                <div className="min-w-0">
                  <p className="font-medium">{editingOrg.name}</p>
                  <p className="text-xs text-muted-foreground">
                    Slug : {editingOrg.slug} — le nom, le slug et le logo sont définis par
                    l'organisation principale du référentiel et mis à jour à chaque synchronisation.
                  </p>
                </div>
              </div>
            )}
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
                Enregistrer
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

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Importer une organisation principale du référentiel</DialogTitle>
            <p className="text-sm text-muted-foreground">
              Seules les organisations principales (racines) sont proposées, dans la limite du
              périmètre de la clé API. Leurs sous-organisations sont importées automatiquement à la
              synchronisation.
            </p>
          </DialogHeader>
          {socleLoading ? (
            <p className="py-6 text-center text-muted-foreground">
              Chargement des organisations du référentiel…
            </p>
          ) : socleError ? (
            <p className="text-sm text-destructive">
              Impossible de contacter le référentiel :{" "}
              {socleErr instanceof Error ? socleErr.message : "erreur inconnue"}. La clé API n'est
              peut-être pas configurée, ou l'organisation recherchée est hors du périmètre de la clé.
            </p>
          ) : newSocleOrgs.length === 0 ? (
            <p className="py-6 text-center text-muted-foreground">
              Toutes les organisations principales accessibles sont déjà présentes dans Clara.
            </p>
          ) : (
            <div className="max-h-[50vh] space-y-2 overflow-y-auto">
              {newSocleOrgs.map((so) => (
                <div
                  key={so.id}
                  className="flex items-center justify-between gap-3 rounded-md border p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{so.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {so.slug ?? "—"}
                      {so.type ? ` · ${so.type}` : ""}
                      {so.status === "obsolete" ? " · obsolète" : ""}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    className="shrink-0"
                    disabled={importMutation.isPending && importMutation.variables?.id === so.id}
                    onClick={() => importMutation.mutate(so)}
                  >
                    <Download className="mr-1.5 h-4 w-4" /> Importer
                  </Button>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
