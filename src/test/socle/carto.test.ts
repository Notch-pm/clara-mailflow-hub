import { describe, expect, it } from "vitest";
import {
  clampZoom,
  geocodeUrl,
  mapTiles,
  MAX_ZOOM,
  MIN_ZOOM,
  parseGeocodeResponse,
  PRECISION_LABELS,
  precisionOf,
  TILE_SIZE,
  worldPixel,
  zoomForPrecision,
} from "@/lib/carto";

// La carte est une brique de CONFORT : elle situe une adresse, elle ne la
// stocke pas. Sa géométrie est pure — un conteneur non mesuré ne doit produire
// aucune tuile plutôt qu'une mosaïque au hasard.

const VIEW = { lat: 47.2, lon: -1.5, zoom: 17, width: 600, height: 200 };

describe("mosaïque de tuiles", () => {
  it("couvre le conteneur, chaque tuile portant sa place", () => {
    const tiles = mapTiles(VIEW);
    expect(tiles.length).toBeGreaterThan(0);
    for (const tile of tiles) {
      expect(tile.url).toMatch(/^https:\/\/tile\.openstreetmap\.org\/17\/\d+\/\d+\.png$/);
      expect(tile.left).toBeLessThan(VIEW.width);
      expect(tile.top).toBeLessThan(VIEW.height);
    }
  });

  it("pose le point demandé au CENTRE exact du conteneur", () => {
    // C'est ce qui dispense le marqueur de toute position à calculer.
    const center = worldPixel(VIEW.lat, VIEW.lon, VIEW.zoom);
    const tiles = mapTiles(VIEW);
    const originX = center.x - VIEW.width / 2;
    const first = tiles[0];
    expect(first.left).toBe(Math.floor(originX / TILE_SIZE) * TILE_SIZE - originX);
  });

  it("ne rend rien tant que le conteneur n'est pas mesuré", () => {
    expect(mapTiles({ ...VIEW, width: 0 })).toEqual([]);
    expect(mapTiles({ ...VIEW, height: 0 })).toEqual([]);
    expect(mapTiles({ ...VIEW, lat: Number.NaN })).toEqual([]);
  });

  it("borne le zoom à ce que le fournisseur de tuiles sert", () => {
    expect(clampZoom(99)).toBe(MAX_ZOOM);
    expect(clampZoom(-3)).toBe(MIN_ZOOM);
    expect(clampZoom(Number.NaN)).toBeGreaterThanOrEqual(MIN_ZOOM);
  });
});

describe("géocodage d'une adresse écrite", () => {
  it("ne cherche pas une adresse trop courte, et cible la commune quand on la connaît", () => {
    expect(geocodeUrl("ru", null)).toBeNull();
    const url = new URL(geocodeUrl("10 avenue de frémeur", "44000")!);
    expect(url.searchParams.get("autocomplete")).toBe("0");
    expect(url.searchParams.get("postcode")).toBe("44000");
    // Un code postal qui n'en est pas un ne part pas.
    expect(new URL(geocodeUrl("rue des lilas", "Nantes")!).searchParams.get("postcode")).toBeNull();
  });

  it("annonce la finesse du point plutôt que de laisser croire à l'exactitude", () => {
    expect(precisionOf("housenumber")).toBe("adresse");
    expect(precisionOf("street")).toBe("voie");
    expect(precisionOf(undefined)).toBe("commune");
    expect(precisionOf("inconnu")).toBe("commune");
    expect(zoomForPrecision("adresse")).toBeGreaterThan(zoomForPrecision("commune"));
    expect(PRECISION_LABELS.commune).toContain("non trouvée");
  });

  it("lit le premier point exploitable, et rend null sur une réponse informe", () => {
    const point = parseGeocodeResponse({
      features: [
        {
          geometry: { coordinates: [-1.5, 47.2] },
          properties: { label: "10 bis Avenue de Frémeur 44000 Nantes", type: "housenumber", score: 0.9 },
        },
      ],
    });
    expect(point).toMatchObject({ lat: 47.2, lon: -1.5, precision: "adresse" });
    expect(parseGeocodeResponse({ features: [] })).toBeNull();
    expect(parseGeocodeResponse("pas du GeoJSON")).toBeNull();
  });
});
