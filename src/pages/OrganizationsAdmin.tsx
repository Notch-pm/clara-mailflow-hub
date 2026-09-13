import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Trash2, Building2, Settings, RefreshCw, Landmark, Download } from "lucide-react";
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
  // Idem pour la charte graphique : les couleurs viennent du référentiel, un
  // écran qui ne le dit pas laisse chercher où on les modifie.
  if (counters.charte_synchronisee) parts.push("Charte graphique : à jour");
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
// principale du référentiel (plus de création locale), et **rien** ne s'y édite :
// nom, slug, logo et charte graphique (couleurs) sont fixés par le référentiel
// et recopiés à chaque synchronisation. Cet écran importe, synchronise,
// paramètre le métier — il ne saisit plus d'identité visuelle.
export default function OrganizationsAdmin() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [deleteConfirm, setDeleteConfirm] = useState<OrgRow | null>(null);

  const { data: organizations, isLoading } = useQuery({
    queryKey: ["superadmin-organizations"],
    queryFn: async () => {
      const { data, error } = await supabase.from("organizations").select("*").order("name");
      if (error) throw error;
      return data as OrgRow[];
    },
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Organisations</h1>
          <p className="text-muted-foreground">
            Gestion des organisations de la plateforme. Nom, logo et charte graphique se
            définissent dans le référentiel et arrivent par la synchronisation.
          </p>
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
                <TableHead>Charte graphique</TableHead>
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
                    {/* Reflet du référentiel, en lecture seule : les couleurs se
                        saisissent là-bas et arrivent par la synchronisation. */}
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {org.primary_color && (
                          <div className="h-4 w-4 rounded-full border" style={{ backgroundColor: org.primary_color }} title={`Couleur principale ${org.primary_color} (référentiel)`} />
                        )}
                        {org.secondary_color && (
                          <div className="h-4 w-4 rounded-full border" style={{ backgroundColor: org.secondary_color }} title={`Couleur secondaire ${org.secondary_color} (référentiel)`} />
                        )}
                        {!org.primary_color && !org.secondary_color && (
                          <span className="text-xs text-muted-foreground">
                            {org.socle_org_id ? "Aucune dans le référentiel" : "—"}
                          </span>
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
