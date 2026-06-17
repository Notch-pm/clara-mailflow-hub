import { supabase } from "@/integrations/supabase/client";
import type { Geometry } from "geojson";

export interface Quartier {
  id: string;
  organization_id: string;
  name: string;
  color: string | null;
  created_at: string;
  created_by: string | null;
}

export interface QuartierGeoJson {
  id: string;
  name: string;
  color: string | null;
  geojson: Geometry;
}

/**
 * Palette de couleurs des quartiers — même esprit que TAG_COLOR_PALETTE
 * (src/services/courierTagService.ts), dédiée pour ne pas coupler les deux
 * référentiels.
 */
export const QUARTIER_COLOR_PALETTE: { name: string; value: string }[] = [
  { name: "Vert", value: "hsl(152 83% 42%)" },
  { name: "Jaune", value: "hsl(43 100% 67%)" },
  { name: "Bleu", value: "hsl(212 92% 55%)" },
  { name: "Rouge", value: "hsl(0 84% 60%)" },
  { name: "Violet", value: "hsl(265 80% 60%)" },
  { name: "Orange", value: "hsl(25 95% 55%)" },
  { name: "Rose", value: "hsl(330 81% 60%)" },
  { name: "Gris", value: "hsl(220 9% 46%)" },
];

export async function listQuartiers(orgId: string): Promise<Quartier[]> {
  const { data, error } = await supabase
    .from("quartiers" as never)
    .select("id, organization_id, name, color, created_at, created_by")
    .eq("organization_id", orgId)
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as Quartier[];
}

/**
 * Quartiers avec leur géométrie en GeoJSON (pour affichage carte).
 * PostGIS stocke en geometry binaire ; la RPC fait le cast ST_AsGeoJSON côté serveur.
 */
export async function listQuartiersGeoJson(orgId: string): Promise<QuartierGeoJson[]> {
  const { data, error } = await (supabase.rpc as unknown as (
    fn: string,
    params: Record<string, unknown>,
  ) => Promise<{ data: QuartierGeoJson[] | null; error: unknown }>)("list_quartiers_geojson", {
    p_org_id: orgId,
  });
  if (error) throw error;
  return data ?? [];
}

/**
 * Crée un quartier à partir d'une géométrie GeoJSON (Polygon ou MultiPolygon),
 * typiquement extraite d'un fichier .geojson importé. La conversion/validation
 * de la géométrie (ST_MakeValid) se fait côté serveur (RPC create_quartier_from_geojson).
 */
export async function importQuartierFromGeoJson(
  orgId: string,
  name: string,
  color: string | null,
  geometry: Geometry,
): Promise<string> {
  const { data, error } = await (supabase.rpc as unknown as (
    fn: string,
    params: Record<string, unknown>,
  ) => Promise<{ data: string | null; error: unknown }>)("create_quartier_from_geojson", {
    p_org_id: orgId,
    p_name: name.trim(),
    p_color: color,
    p_geojson: geometry,
  });
  if (error) throw error;
  return data as string;
}

export interface QuartierBatchItem {
  name: string;
  color: string | null;
  geometry: Geometry;
}

export interface QuartierBatchResult {
  id: string;
  name: string;
}

/**
 * Import en lot : un seul appel RPC = une seule transaction côté Postgres
 * (si un élément échoue, tout le lot est annulé — pas d'import partiel).
 * Les collisions de nom (ex. plusieurs communes ayant chacune un quartier
 * "Centre") sont dédoublonnées automatiquement côté serveur (" (2)", " (3)"…) ;
 * le nom réellement utilisé est renvoyé dans le résultat pour pouvoir
 * signaler les renommages à l'utilisateur.
 */
export async function importQuartiersBatch(
  orgId: string,
  items: QuartierBatchItem[],
): Promise<QuartierBatchResult[]> {
  const { data, error } = await (supabase.rpc as unknown as (
    fn: string,
    params: Record<string, unknown>,
  ) => Promise<{ data: { quartier_id: string; quartier_name: string }[] | null; error: unknown }>)(
    "create_quartiers_batch",
    {
      p_org_id: orgId,
      p_items: items.map((i) => ({ name: i.name.trim(), color: i.color, geometry: i.geometry })),
    },
  );
  if (error) throw error;
  return (data ?? []).map((r) => ({ id: r.quartier_id, name: r.quartier_name }));
}

export async function renameQuartier(id: string, name: string, color: string | null): Promise<void> {
  const { error } = await supabase
    .from("quartiers" as never)
    .update({ name: name.trim(), color } as never)
    .eq("id", id);
  if (error) throw error;
}

export async function deleteQuartier(id: string): Promise<void> {
  const { error } = await supabase.from("quartiers" as never).delete().eq("id", id);
  if (error) throw error;
}

/**
 * Réapplique l'assignation automatique (quartier_for_point) à tous les usagers
 * en mode quartier_auto=true. À appeler après import/édition d'un polygone.
 */
export async function recalculateQuartiers(orgId: string): Promise<void> {
  const { error } = await (supabase.rpc as unknown as (
    fn: string,
    params: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: unknown }>)("recalculate_usager_quartiers", {
    p_org_id: orgId,
  });
  if (error) throw error;
}

/**
 * Détermine le quartier contenant un point donné (assignation automatique
 * à la saisie/sélection d'une adresse). Retourne null si hors de tout polygone.
 */
export async function findQuartierForPoint(
  orgId: string,
  lon: number,
  lat: number,
): Promise<string | null> {
  const { data, error } = await (supabase.rpc as unknown as (
    fn: string,
    params: Record<string, unknown>,
  ) => Promise<{ data: string | null; error: unknown }>)("quartier_for_point", {
    p_org_id: orgId,
    p_lon: lon,
    p_lat: lat,
  });
  if (error) throw error;
  return data ?? null;
}

export interface QuartierUsagerCount {
  quartier_id: string | null;
  quartier_name: string;
  color: string | null;
  count: number;
}

/**
 * Nombre d'usagers par quartier (+ ligne "Sans quartier"), utilisé pour la
 * colonne "Nb usagers" de la page d'admin. Même RPC que la stat dédiée
 * (src/services/statsService.ts) consommée par la page Statistiques.
 */
export async function getQuartierUsagerCounts(orgId: string): Promise<QuartierUsagerCount[]> {
  const { data, error } = await (supabase.rpc as unknown as (
    fn: string,
    params: Record<string, unknown>,
  ) => Promise<{ data: QuartierUsagerCount[] | null; error: unknown }>)("stats_usagers_by_quartier", {
    p_org_id: orgId,
  });
  if (error) throw error;
  return data ?? [];
}

export interface UsagerOutsideQuartier {
  id: string;
  first_name: string | null;
  last_name: string | null;
  address_lat: number;
  address_lon: number;
}

/**
 * Substitut pragmatique à "rues hors quartiers" : usagers géolocalisés ne
 * tombant dans aucun polygone de quartier (aucune donnée de voirie externe).
 */
export async function listUsagersOutsideQuartiers(orgId: string): Promise<UsagerOutsideQuartier[]> {
  const { data, error } = await (supabase.rpc as unknown as (
    fn: string,
    params: Record<string, unknown>,
  ) => Promise<{ data: UsagerOutsideQuartier[] | null; error: unknown }>)("usagers_outside_quartiers", {
    p_org_id: orgId,
  });
  if (error) throw error;
  return data ?? [];
}
