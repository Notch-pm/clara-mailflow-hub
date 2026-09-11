// Mosaïque de tuiles + attribution — la seule brique qui « peint » une carte.
// Toute la géométrie vit dans `src/lib/carto.ts` (pure, testée) ; ce composant
// ne fait que positionner des images.
//
// Pas de bibliothèque de carte : une carte de contrôle n'a ni calques, ni
// déplacement, ni épingles multiples — des `<img>` positionnées suffisent, et
// rien ne s'ajoute au bundle.
//
// L'attribution OpenStreetMap (ODbL) est portée par la mosaïque elle-même :
// elle suit ainsi toutes les cartes, sans risque d'oubli.

import { mapTiles, TILE_SIZE, type MapView } from "@/lib/carto";

export function TileLayer({ view }: { view: MapView }) {
  const tiles = mapTiles(view);
  return (
    <>
      {tiles.map((tile) => (
        <img
          key={tile.key}
          src={tile.url}
          alt=""
          width={TILE_SIZE}
          height={TILE_SIZE}
          // Pas de `loading="lazy"` : les tuiles SONT le contenu, les différer
          // laisse la carte blanche au chargement et au zoom.
          draggable={false}
          className="pointer-events-none absolute max-w-none select-none"
          style={{ left: tile.left, top: tile.top }}
          onError={(event) => {
            event.currentTarget.style.visibility = "hidden";
          }}
        />
      ))}
      <a
        href="https://www.openstreetmap.org/copyright"
        target="_blank"
        rel="noreferrer"
        className="absolute bottom-0 right-0 z-10 rounded-tl-lg bg-background/85 px-1.5 py-0.5 text-[10px] text-muted-foreground hover:underline"
      >
        © les contributeurs OpenStreetMap
      </a>
    </>
  );
}

