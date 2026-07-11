import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import {
  listProcedures,
  updateProcedureVisibility,
  type Procedure,
} from "@/services/procedureService";
import {
  getLastSyncRun,
  listSocleCategories,
  triggerSocleSync,
  type SocleSyncResult,
} from "@/services/socleSyncService";
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
import { FileText, Search, Import, RefreshCw, Landmark } from "lucide-react";
import { toast } from "sonner";

interface Props {
  organizationId?: string;
  isAdminOverride?: boolean;
}

function isUrl(v: string | null | undefined): boolean {
  return !!v && (v.startsWith("http://") || v.startsWith("https://"));
}

function formatSyncDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { dateStyle: "long" }) +
    " à " +
    new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

function syncSummaryMessage(result: SocleSyncResult): string {
  const r = result.results?.[0];
  if (!r?.counters) return result.message;
  const p = r.counters.procedures;
  return `Démarches : ${p.created} créée(s), ${p.adopted} rapprochée(s), ${p.updated} mise(s) à jour, ${p.obsoleted} obsolète(s), ${p.unchanged} inchangée(s).`;
}

export default function ProceduresSettings({ organizationId, isAdminOverride }: Props) {
  const { membership, profile } = useAuth();
  const queryClient = useQueryClient();

  const orgId = organizationId ?? membership?.organization_id ?? "";
  const isAdmin =
    isAdminOverride ?? (membership?.role === "administrateur" || !!profile?.is_superadmin);

  const [search, setSearch] = useState("");
  const [showHidden, setShowHidden] = useState(false);

  const { data: procedures = [], isLoading } = useQuery({
    queryKey: ["procedures", orgId],
    queryFn: () => listProcedures(orgId!),
    enabled: !!orgId,
  });

  const { data: categories = [] } = useQuery({
    queryKey: ["socle-categories", orgId],
    queryFn: () => listSocleCategories(orgId!),
    enabled: !!orgId,
  });

  const { data: lastSync } = useQuery({
    queryKey: ["socle-last-sync", orgId],
    queryFn: () => getLastSyncRun(orgId!),
    enabled: !!orgId,
  });

  const categoryNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of categories) map.set(c.socle_id, c.name);
    return map;
  }, [categories]);

  const updateMutation = useMutation({
    mutationFn: ({ id, isDisplayed }: { id: string; isDisplayed: boolean }) =>
      updateProcedureVisibility(id, isDisplayed),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["procedures", orgId] });
    },
    onError: (e: Error) => toast.error("Erreur : " + e.message),
  });

  const syncMutation = useMutation({
    mutationFn: () => triggerSocleSync(orgId),
    onSuccess: (result) => {
      toast.success("Synchronisation Socle terminée", {
        description: syncSummaryMessage(result),
      });
      queryClient.invalidateQueries({ queryKey: ["procedures", orgId] });
      queryClient.invalidateQueries({ queryKey: ["socle-categories", orgId] });
      queryClient.invalidateQueries({ queryKey: ["socle-last-sync", orgId] });
    },
    onError: (e: Error) => toast.error("Échec de la synchronisation : " + e.message),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return procedures.filter(
      (p) =>
        !q ||
        p.name.toLowerCase().includes(q) ||
        (p.description ?? "").toLowerCase().includes(q),
    );
  }, [procedures, search]);

  const visible = filtered.filter((p) => p.is_displayed && !p.obsoleted_at);
  const hidden = filtered.filter((p) => !p.is_displayed || p.obsoleted_at);

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
            Les démarches sont gérées dans le Socle et synchronisées automatiquement chaque nuit.
            {lastSync?.finished_at && lastSync.status === "success" && (
              <> Dernière synchronisation : {formatSyncDate(lastSync.finished_at)}.</>
            )}
            {lastSync?.status === "error" && (
              <span className="text-destructive"> Dernière synchronisation en échec.</span>
            )}
          </p>
        </div>
        {isAdmin && (
          <Button
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
            variant="outline"
            className="gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${syncMutation.isPending ? "animate-spin" : ""}`} />
            {syncMutation.isPending ? "Synchronisation…" : "Synchroniser maintenant"}
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
              <p>
                {search
                  ? "Aucun résultat"
                  : "Aucune démarche synchronisée — vérifiez le mapping Socle de l'organisation"}
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {visible.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Démarche</TableHead>
                      <TableHead className="w-40">Catégorie</TableHead>
                      <TableHead className="w-24 text-center">Visible</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visible.map((p) => (
                      <ProcedureRow
                        key={p.id}
                        procedure={p}
                        categoryName={p.socle_category_id ? categoryNames.get(p.socle_category_id) : undefined}
                        isAdmin={!!isAdmin}
                        onToggle={(proc, val) =>
                          updateMutation.mutate({ id: proc.id, isDisplayed: val })
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
                          <TableHead className="w-40">Catégorie</TableHead>
                          <TableHead className="w-24 text-center">Visible</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {hidden.map((p) => (
                          <ProcedureRow
                            key={p.id}
                            procedure={p}
                            categoryName={p.socle_category_id ? categoryNames.get(p.socle_category_id) : undefined}
                            isAdmin={!!isAdmin}
                            faded
                            onToggle={(proc, val) =>
                              updateMutation.mutate({ id: proc.id, isDisplayed: val })
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
    </div>
  );
}

function ProcedureRow({
  procedure,
  categoryName,
  isAdmin,
  faded,
  onToggle,
}: {
  procedure: Procedure;
  categoryName?: string;
  isAdmin: boolean;
  faded?: boolean;
  onToggle: (p: Procedure, val: boolean) => void;
}) {
  const isObsolete = !!procedure.obsoleted_at;
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
              {procedure.external_source === "socle" ? (
                <Badge variant="secondary" className="text-[10px] gap-1 px-1.5 py-0 h-5 shrink-0">
                  <Landmark className="h-3 w-3" />
                  Socle
                </Badge>
              ) : procedure.external_source ? (
                <Badge variant="secondary" className="text-[10px] gap-1 px-1.5 py-0 h-5 shrink-0">
                  <Import className="h-3 w-3" />
                  {procedure.external_source === "arpege" ? "Arpège" : procedure.external_source}
                </Badge>
              ) : null}
              {procedure.type && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 shrink-0">
                  {procedure.type === "interne" ? "Interne" : procedure.type === "externe" ? "Externe" : procedure.type}
                </Badge>
              )}
              {isObsolete && (
                <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-5 shrink-0">
                  Obsolète
                </Badge>
              )}
            </div>
            {procedure.description && (
              <p className="text-xs text-muted-foreground line-clamp-1">{procedure.description}</p>
            )}
          </div>
        </div>
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {categoryName ?? "—"}
      </TableCell>
      <TableCell className="text-center">
        <Switch
          checked={procedure.is_displayed}
          onCheckedChange={(val) => onToggle(procedure, val)}
          disabled={!isAdmin || isObsolete}
        />
      </TableCell>
    </TableRow>
  );
}
