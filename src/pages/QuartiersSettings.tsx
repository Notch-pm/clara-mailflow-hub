import { useEffect, useState, type ChangeEvent } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { MapContainer, TileLayer, GeoJSON, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { MapPin, Upload, Pencil, Trash2, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { readableTextColor } from "@/lib/tag-color";
import {
  listQuartiers,
  listQuartiersGeoJson,
  importQuartiersBatch,
  renameQuartier,
  deleteQuartier,
  recalculateQuartiers,
  getQuartierUsagerCounts,
  QUARTIER_COLOR_PALETTE,
  type Quartier,
} from "@/services/quartierService";

interface Props {
  organizationId?: string;
  isAdminOverride?: boolean;
}

const FRANCE_CENTER: [number, number] = [46.6, 1.88];

function FitBounds({ data }: { data: FeatureCollection | null }) {
  const map = useMap();
  useEffect(() => {
    if (!data || !data.features.length) return;
    const bounds = L.geoJSON(data as never).getBounds();
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [20, 20] });
  }, [data, map]);
  return null;
}

function guessName(properties: Record<string, unknown> | null | undefined): string | null {
  if (!properties) return null;
  const candidates = ["name", "nom", "Nom", "NOM", "nom_quartier", "NOM_QUARTIER", "label", "libelle", "LIBELLE"];
  for (const key of candidates) {
    const v = properties[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

interface ParsedRow {
  geometry: Geometry;
  name: string;
  color: string;
}

/**
 * Dédoublonne les noms au sein du même import (ex. plusieurs communes ayant
 * chacune un quartier "Centre") avant envoi — le serveur fait aussi ce
 * contrôle en filet de sécurité (vs. quartiers déjà existants en base).
 */
function dedupeNames<T extends { name: string }>(items: T[]): T[] {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const key = item.name.trim().toLowerCase();
    const count = seen.get(key) ?? 0;
    seen.set(key, count + 1);
    return count === 0 ? item : { ...item, name: `${item.name} (${count + 1})` };
  });
}

function extractFeatures(json: unknown): { geometry: Geometry; properties: Record<string, unknown> | null }[] {
  const obj = json as { type?: string; features?: unknown[]; geometry?: Geometry; properties?: Record<string, unknown> };
  if (obj?.type === "FeatureCollection" && Array.isArray(obj.features)) {
    return (obj.features as Feature[])
      .filter((f) => !!f?.geometry)
      .map((f) => ({ geometry: f.geometry as Geometry, properties: (f.properties as Record<string, unknown>) ?? null }));
  }
  if (obj?.type === "Feature" && obj.geometry) {
    return [{ geometry: obj.geometry, properties: obj.properties ?? null }];
  }
  if (obj?.type === "Polygon" || obj?.type === "MultiPolygon") {
    return [{ geometry: obj as unknown as Geometry, properties: null }];
  }
  return [];
}

function ImportGeoJsonDialog({
  open,
  onOpenChange,
  orgId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  orgId: string;
}) {
  const qc = useQueryClient();
  const [rows, setRows] = useState<ParsedRow[] | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileError(null);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const json = JSON.parse(reader.result as string);
        const features = extractFeatures(json);
        if (!features.length) throw new Error("Aucun polygone trouvé dans ce fichier.");
        setRows(
          dedupeNames(
            features.map((f, i) => ({
              geometry: f.geometry,
              name: guessName(f.properties) ?? `Quartier ${i + 1}`,
              color: QUARTIER_COLOR_PALETTE[i % QUARTIER_COLOR_PALETTE.length].value,
            })),
          ),
        );
      } catch (err) {
        setFileError(err instanceof Error ? err.message : "Fichier GeoJSON invalide");
        setRows(null);
      }
    };
    reader.readAsText(file);
  }

  const importMut = useMutation({
    mutationFn: async () => {
      if (!rows) return [];
      // Import en un seul appel RPC (transaction atomique côté Postgres) :
      // soit tout le lot est créé, soit rien ne l'est en cas d'erreur.
      const results = await importQuartiersBatch(
        orgId,
        rows.map((r) => ({ name: r.name, color: r.color, geometry: r.geometry })),
      );
      await recalculateQuartiers(orgId);
      return results;
    },
    onSuccess: (results) => {
      qc.invalidateQueries({ queryKey: ["quartiers", orgId] });
      qc.invalidateQueries({ queryKey: ["quartiers-geojson", orgId] });
      qc.invalidateQueries({ queryKey: ["quartiers-counts", orgId] });
      qc.invalidateQueries({ queryKey: ["usagers"] });
      const renamedCount = results.filter((r, i) => rows && r.name !== rows[i]?.name).length;
      toast.success(
        `${results.length} quartier(s) importé(s)` +
          (renamedCount ? ` (${renamedCount} renommé(s) pour éviter un doublon)` : ""),
      );
      onOpenChange(false);
      setRows(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) {
          setRows(null);
          setFileError(null);
        }
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Importer des quartiers (GeoJSON)</DialogTitle>
        </DialogHeader>
        {!rows ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Fichier .geojson contenant un ou plusieurs polygones (FeatureCollection, Feature ou Geometry) —
              par exemple un export QGIS ou un jeu de données ouvertes de la commune.
            </p>
            <Input type="file" accept=".geojson,application/geo+json,application/json,.json" onChange={handleFile} />
            {fileError && <p className="text-sm text-destructive">{fileError}</p>}
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {rows.length} polygone(s) détecté(s). Ajustez le nom et la couleur de chaque quartier avant l'import.
            </p>
            <div className="space-y-2">
              {rows.map((r, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    value={r.name}
                    onChange={(e) =>
                      setRows((prev) => prev!.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
                    }
                    className="flex-1"
                  />
                  <div className="flex gap-1">
                    {QUARTIER_COLOR_PALETTE.map((c) => (
                      <button
                        key={c.value}
                        type="button"
                        title={c.name}
                        aria-label={c.name}
                        onClick={() =>
                          setRows((prev) => prev!.map((x, j) => (j === i ? { ...x, color: c.value } : x)))
                        }
                        className={`h-5 w-5 rounded-full border-2 transition-all ${
                          r.color === c.value ? "border-foreground scale-110" : "border-transparent"
                        }`}
                        style={{ backgroundColor: c.value }}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <Button className="w-full" onClick={() => importMut.mutate()} disabled={importMut.isPending}>
              {importMut.isPending ? "Import…" : `Importer ${rows.length} quartier(s)`}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function QuartierRow({
  quartier,
  usagerCount,
  isAdmin,
  orgId,
}: {
  quartier: Quartier;
  usagerCount: number;
  isAdmin: boolean;
  orgId: string;
}) {
  const qc = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [name, setName] = useState(quartier.name);
  const [color, setColor] = useState(quartier.color ?? QUARTIER_COLOR_PALETTE[0].value);

  const updateMut = useMutation({
    mutationFn: () => renameQuartier(quartier.id, name, color),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["quartiers", orgId] });
      qc.invalidateQueries({ queryKey: ["quartiers-geojson", orgId] });
      qc.invalidateQueries({ queryKey: ["quartiers-counts", orgId] });
      toast.success("Quartier mis à jour");
      setEditOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: () => deleteQuartier(quartier.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["quartiers", orgId] });
      qc.invalidateQueries({ queryKey: ["quartiers-geojson", orgId] });
      qc.invalidateQueries({ queryKey: ["quartiers-counts", orgId] });
      qc.invalidateQueries({ queryKey: ["usagers"] });
      toast.success("Quartier supprimé");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const fg = quartier.color ? readableTextColor(quartier.color) : undefined;

  return (
    <TableRow>
      <TableCell>
        <Badge
          variant="secondary"
          className="font-medium"
          style={quartier.color ? { backgroundColor: quartier.color, color: fg } : undefined}
        >
          {quartier.name}
        </Badge>
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">{usagerCount}</TableCell>
      <TableCell className="text-right">
        {isAdmin && (
          <div className="flex justify-end gap-1">
            <Popover open={editOpen} onOpenChange={setEditOpen}>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Modifier">
                  <Pencil className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-72 space-y-3" align="end">
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nom du quartier" />
                <div className="flex flex-wrap gap-2">
                  {QUARTIER_COLOR_PALETTE.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      title={c.name}
                      aria-label={c.name}
                      onClick={() => setColor(c.value)}
                      className={`h-6 w-6 rounded-full border-2 transition-all ${
                        color === c.value ? "border-foreground scale-110" : "border-transparent"
                      }`}
                      style={{ backgroundColor: c.value }}
                    />
                  ))}
                </div>
                <Button
                  size="sm"
                  className="w-full"
                  disabled={!name.trim() || updateMut.isPending}
                  onClick={() => updateMut.mutate()}
                >
                  Enregistrer
                </Button>
              </PopoverContent>
            </Popover>
            <Button
              variant="ghost"
              size="icon"
              className="text-destructive"
              aria-label="Supprimer"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        )}

        <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Supprimer le quartier « {quartier.name} » ?</AlertDialogTitle>
              <AlertDialogDescription>
                Les usagers actuellement rattachés à ce quartier ne seront pas supprimés mais perdront ce
                rattachement.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Annuler</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => deleteMut.mutate()}
              >
                Supprimer
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </TableCell>
    </TableRow>
  );
}

export default function QuartiersSettings({ organizationId, isAdminOverride }: Props) {
  const { membership } = useAuth();
  const orgId = organizationId ?? membership?.organization_id ?? "";
  const isAdmin = isAdminOverride ?? (membership?.role === "admin" || membership?.role === "administrateur");

  const qc = useQueryClient();
  const [importOpen, setImportOpen] = useState(false);

  const { data: quartiers = [], isLoading } = useQuery({
    queryKey: ["quartiers", orgId],
    queryFn: () => listQuartiers(orgId),
    enabled: !!orgId,
  });

  const { data: geoJsonQuartiers = [] } = useQuery({
    queryKey: ["quartiers-geojson", orgId],
    queryFn: () => listQuartiersGeoJson(orgId),
    enabled: !!orgId,
  });

  const { data: counts = [] } = useQuery({
    queryKey: ["quartiers-counts", orgId],
    queryFn: () => getQuartierUsagerCounts(orgId),
    enabled: !!orgId,
  });
  const countByQuartier = new Map(counts.map((c) => [c.quartier_id, c.count]));
  const unassignedCount = counts.find((c) => c.quartier_id === null)?.count ?? 0;

  const recalcMut = useMutation({
    mutationFn: () => recalculateQuartiers(orgId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["quartiers-counts", orgId] });
      qc.invalidateQueries({ queryKey: ["usagers"] });
      toast.success("Assignation des usagers recalculée");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const featureCollection: FeatureCollection | null = geoJsonQuartiers.length
    ? {
        type: "FeatureCollection",
        features: geoJsonQuartiers.map((q) => ({
          type: "Feature",
          geometry: q.geojson,
          properties: { id: q.id, name: q.name, color: q.color },
        })),
      }
    : null;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <MapPin className="h-5 w-5 text-primary" />
              </div>
              <div>
                <CardTitle>Quartiers</CardTitle>
                <CardDescription>
                  Découpage de la commune en quartiers, utilisé pour rattacher les usagers et produire des
                  statistiques.
                </CardDescription>
              </div>
            </div>
            {isAdmin && (
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => recalcMut.mutate()} disabled={recalcMut.isPending}>
                  <RefreshCw className="h-4 w-4 mr-1" />
                  Recalculer les assignations
                </Button>
                <Button onClick={() => setImportOpen(true)}>
                  <Upload className="h-4 w-4 mr-1" />
                  Importer un GeoJSON
                </Button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {!isAdmin && (
            <Alert>
              <AlertDescription>
                Seuls les administrateurs peuvent importer, modifier ou supprimer des quartiers.
              </AlertDescription>
            </Alert>
          )}

          <div className="h-96 w-full overflow-hidden rounded-md border isolate relative">
            <MapContainer center={FRANCE_CENTER} zoom={5} style={{ height: "100%", width: "100%" }}>
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              {featureCollection && (
                <GeoJSON
                  key={geoJsonQuartiers.map((q) => q.id).join(",")}
                  data={featureCollection}
                  style={(feature) => ({
                    color: (feature?.properties?.color as string) ?? "#0acf83",
                    weight: 2,
                    fillOpacity: 0.3,
                  })}
                />
              )}
              <FitBounds data={featureCollection} />
            </MapContainer>
          </div>

          {isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : quartiers.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Aucun quartier défini. {isAdmin && "Importez un fichier GeoJSON pour commencer."}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quartier</TableHead>
                  <TableHead>Usagers</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {quartiers.map((q) => (
                  <QuartierRow
                    key={q.id}
                    quartier={q}
                    usagerCount={countByQuartier.get(q.id) ?? 0}
                    isAdmin={isAdmin}
                    orgId={orgId}
                  />
                ))}
                {unassignedCount > 0 && (
                  <TableRow>
                    <TableCell>
                      <Badge variant="outline">Sans quartier</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{unassignedCount}</TableCell>
                    <TableCell />
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {isAdmin && orgId && (
        <ImportGeoJsonDialog open={importOpen} onOpenChange={setImportOpen} orgId={orgId} />
      )}
    </div>
  );
}
