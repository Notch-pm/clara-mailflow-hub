// Cartographie libre — logique PURE (ni DOM ni réseau) : projection Web
// Mercator découpée en tuiles, et lecture d'une réponse de géocodage.
//
// Porté d'Iris (`src/lib/carto.ts` du dépôt iris) pour que la même adresse se
// voie pareil dans les deux produits. Sous-ensemble volontaire : Clara affiche
// UN point de contrôle sous un champ d'adresse, elle ne cadre pas une
// collection d'épingles — ni `fitBounds`, ni géocodage en masse, ni
// déplacement à la souris.
//
// Deux services publics, sans clé ni compte (rien de secret dans le bundle) :
//  - **tuiles** : OpenStreetMap. L'affichage DOIT porter l'attribution
//    « © les contributeurs OpenStreetMap » (ODbL) — elle est dans `TileLayer`,
//    ne pas la retirer. La politique d'usage de l'OSMF réserve ses serveurs aux
//    faibles volumes : `VITE_MAP_TILE_URL` bascule sur un fournisseur dédié
//    sans toucher au code.
//  - **géocodage** : Base Adresse Nationale, servie par la Géoplateforme (IGN)
//    depuis le retrait d'`api-adresse.data.gouv.fr` (janvier 2026).
//    Substituable par `VITE_GEOCODE_URL`, le contrat de réponse attendu restant
//    le GeoJSON BAN.
//
// Ce qui transite vers ces services : une ADRESSE, et rien qui l'accompagne —
// jamais un nom d'usager, jamais une référence de courrier.

export interface CartoConfig {
  /** Gabarit de tuiles raster — jetons `{z}` `{x}` `{y}` (et `{s}` facultatif). */
  tileUrl: string;
  /** Point d'entrée de recherche d'adresse (contrat BAN). */
  geocodeUrl: string;
}

export const DEFAULT_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const DEFAULT_GEOCODE_URL = "https://data.geopf.fr/geocodage/search/";

export function readCartoConfig(env: Record<string, unknown>): CartoConfig {
  const tileUrl = env.VITE_MAP_TILE_URL;
  const geocodeUrl = env.VITE_GEOCODE_URL;
  return {
    tileUrl: typeof tileUrl === "string" && tileUrl.trim() !== "" ? tileUrl.trim() : DEFAULT_TILE_URL,
    geocodeUrl:
      typeof geocodeUrl === "string" && geocodeUrl.trim() !== ""
        ? geocodeUrl.trim()
        : DEFAULT_GEOCODE_URL,
  };
}

export const CARTO: CartoConfig = readCartoConfig(
  (import.meta.env ?? {}) as unknown as Record<string, unknown>,
);

// ── Projection et tuiles ────────────────────────────────────────────────────

export const TILE_SIZE = 256;
export const MIN_ZOOM = 4;
export const MAX_ZOOM = 19;
export const DEFAULT_ZOOM = 17;

/** Latitude au-delà de laquelle la projection Mercator diverge. */
const MERCATOR_LIMIT = 85.05112878;

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return DEFAULT_ZOOM;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom)));
}

/** Position en pixels « monde » (Web Mercator) au niveau de zoom donné. */
export function worldPixel(lat: number, lon: number, zoom: number): { x: number; y: number } {
  const size = TILE_SIZE * 2 ** zoom;
  const rad = (Math.min(MERCATOR_LIMIT, Math.max(-MERCATOR_LIMIT, lat)) * Math.PI) / 180;
  return {
    x: ((lon + 180) / 360) * size,
    y: ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * size,
  };
}

export interface MapTile {
  key: string;
  url: string;
  /** Position absolue de la tuile dans le conteneur, en pixels. */
  left: number;
  top: number;
}

/** Vue courante : centre géographique, zoom, taille du conteneur. */
export interface MapView {
  lat: number;
  lon: number;
  zoom: number;
  width: number;
  height: number;
  tileUrl?: string;
}

const SUBDOMAINS = ["a", "b", "c"] as const;

function tileUrlOf(template: string, z: number, x: number, y: number): string {
  return template
    .replace("{s}", SUBDOMAINS[(x + y) % SUBDOMAINS.length])
    .replace("{z}", String(z))
    .replace("{x}", String(x))
    .replace("{y}", String(y));
}

/**
 * Tuiles couvrant une vue `width`×`height` centrée sur (lat, lon), chacune avec
 * sa position absolue dans le conteneur. Le point demandé tombe au centre exact
 * du conteneur : le marqueur n'a donc aucune position à calculer.
 */
export function mapTiles(input: MapView): MapTile[] {
  const { lat, lon, width, height } = input;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
  if (!(width > 0) || !(height > 0)) return [];

  const zoom = clampZoom(input.zoom);
  const template = input.tileUrl ?? CARTO.tileUrl;
  const count = 2 ** zoom;
  const center = worldPixel(lat, lon, zoom);
  const originX = center.x - width / 2;
  const originY = center.y - height / 2;

  const firstX = Math.floor(originX / TILE_SIZE);
  const lastX = Math.floor((originX + width) / TILE_SIZE);
  const firstY = Math.max(0, Math.floor(originY / TILE_SIZE));
  const lastY = Math.min(count - 1, Math.floor((originY + height) / TILE_SIZE));

  const tiles: MapTile[] = [];
  for (let y = firstY; y <= lastY; y++) {
    for (let x = firstX; x <= lastX; x++) {
      // Antiméridien : l'axe X boucle, l'axe Y non (déjà borné ci-dessus).
      const wrapped = ((x % count) + count) % count;
      tiles.push({
        key: `${zoom}/${x}/${y}`,
        url: tileUrlOf(template, zoom, wrapped, y),
        left: x * TILE_SIZE - originX,
        top: y * TILE_SIZE - originY,
      });
    }
  }
  return tiles;
}

// ── Géocodage ───────────────────────────────────────────────────────────────

export type GeoPrecision = "adresse" | "voie" | "lieu_dit" | "commune";

export interface GeoPoint {
  lat: number;
  lon: number;
  /** Adresse normalisée telle que le géocodeur l'a comprise. */
  label: string;
  precision: GeoPrecision;
  /** Score BAN : classement RELATIF à la réponse, jamais une probabilité. */
  score: number;
}

/** Requête de géocodage — `null` si l'adresse est trop courte pour être cherchée. */
export function geocodeUrl(
  query: string,
  postcode: string | null,
  base = CARTO.geocodeUrl,
): string | null {
  const q = query.trim();
  if (q.length < 3) return null;
  const url = new URL(base);
  url.searchParams.set("q", q);
  url.searchParams.set("limit", "1");
  url.searchParams.set("autocomplete", "0");
  if (postcode && /^\d{5}$/.test(postcode.trim())) url.searchParams.set("postcode", postcode.trim());
  return url.toString();
}

const PRECISION_BY_TYPE: Record<string, GeoPrecision> = {
  housenumber: "adresse",
  street: "voie",
  locality: "lieu_dit",
  municipality: "commune",
};

/** Type de résultat du géocodeur → finesse annoncée (inconnu : la plus large). */
export function precisionOf(type: string | undefined): GeoPrecision {
  if (!type) return "commune";
  return PRECISION_BY_TYPE[type] ?? "commune";
}

/** Zoom d'affichage adapté à la finesse du point trouvé. */
export function zoomForPrecision(precision: GeoPrecision): number {
  switch (precision) {
    case "adresse":
      return 18;
    case "voie":
      return 17;
    case "lieu_dit":
      return 16;
    default:
      return 13;
  }
}

export const PRECISION_LABELS: Record<GeoPrecision, string> = {
  adresse: "Numéro localisé",
  voie: "Voie localisée — numéro non trouvé",
  lieu_dit: "Lieu-dit localisé",
  commune: "Commune seule — adresse non trouvée",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Lecture tolérante d'une réponse GeoJSON BAN : le premier point exploitable,
 * ou `null`. Toute forme inattendue vaut « adresse non localisée » — jamais une
 * exception : la carte est un confort, l'adresse saisie reste affichée.
 */
export function parseGeocodeResponse(raw: unknown): GeoPoint | null {
  if (!isRecord(raw) || !Array.isArray(raw.features)) return null;
  for (const feature of raw.features) {
    if (!isRecord(feature)) continue;
    const geometry = isRecord(feature.geometry) ? feature.geometry : null;
    const coordinates = geometry && Array.isArray(geometry.coordinates) ? geometry.coordinates : null;
    if (!coordinates || coordinates.length < 2) continue;
    const [lon, lat] = coordinates;
    if (typeof lon !== "number" || typeof lat !== "number") continue;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    const properties = isRecord(feature.properties) ? feature.properties : {};
    return {
      lat,
      lon,
      label: typeof properties.label === "string" ? properties.label : "",
      precision: precisionOf(typeof properties.type === "string" ? properties.type : undefined),
      score: typeof properties.score === "number" ? properties.score : 0,
    };
  }
  return null;
}
