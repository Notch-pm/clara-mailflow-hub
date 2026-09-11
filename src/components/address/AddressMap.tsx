// Carte de contrôle sous un champ d'adresse : là où l'adresse saisie est
// tombée, et avec quelle réserve.
//
// C'est un CONFORT de vérification, pas une saisie : le point n'est ni
// déplaçable ni stocké. Clara ne conserve aucune coordonnée — ce qui part dans
// la demande, c'est l'adresse. Un point qu'on pourrait bouger sans que rien ne
// le retienne mentirait sur ce que le formulaire garde.
//
// La mosaïque et son attribution ODbL viennent de `TileLayer` — obligatoire,
// ne pas la retirer.

import { useEffect, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { TileLayer } from "@/components/map/TileLayer";
import { useElementSize } from "@/components/map/useElementSize";
import { cn } from "@/lib/utils";
import {
  clampZoom,
  PRECISION_LABELS,
  zoomForPrecision,
  type GeoPoint,
  type MapView,
} from "@/lib/carto";

interface Props {
  /**
   * Point à montrer. NON NULLABLE à dessein : l'appelant ne monte la carte que
   * lorsqu'il en a un. `useElementSize` mesure au montage — un conteneur qui
   * n'existe pas au premier rendu n'est jamais mesuré, et la mosaïque reste
   * vide pour toujours.
   */
  point: GeoPoint;
  height?: number;
  /** Chargement en cours : la carte reste, on ne la fait pas clignoter. */
  pending?: boolean;
  className?: string;
}

const DEFAULT_HEIGHT = 180;

export function AddressMap({ point, height = DEFAULT_HEIGHT, pending, className }: Props) {
  const { ref, width, height: measured } = useElementSize<HTMLDivElement>();
  const [zoomShift, setZoomShift] = useState(0);

  // Nouvelle adresse localisée → on repart du zoom adapté à sa finesse.
  useEffect(() => setZoomShift(0), [point.lat, point.lon]);

  const zoom = clampZoom(zoomForPrecision(point.precision) + zoomShift);
  const view: MapView = { lat: point.lat, lon: point.lon, zoom, width, height: measured };

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div
        ref={ref}
        style={{ height }}
        className={cn(
          "relative overflow-hidden rounded-lg border border-border bg-muted transition-opacity",
          pending && "opacity-60",
        )}
      >
        <TileLayer view={view} />

        {/* Le point demandé tombe au centre exact du conteneur (cf. `mapTiles`). */}
        <span
          aria-hidden="true"
          className="absolute left-1/2 top-1/2 z-10 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-primary shadow-md"
        />

        <div className="absolute right-1.5 top-1.5 z-10 flex flex-col gap-1">
          <ZoomButton label="Zoom avant" onClick={() => setZoomShift((s) => s + 1)}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          </ZoomButton>
          <ZoomButton label="Zoom arrière" onClick={() => setZoomShift((s) => s - 1)}>
            <Minus className="h-3.5 w-3.5" aria-hidden="true" />
          </ZoomButton>
        </div>
      </div>

      {/* Le géocodeur rend TOUJOURS un candidat : on affiche sa réserve plutôt
          que de laisser croire que le point est exact. */}
      <p className="text-[11px] text-muted-foreground">
        {PRECISION_LABELS[point.precision]}
        {point.label ? ` — ${point.label}` : ""}
      </p>
    </div>
  );
}

function ZoomButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      onClick={onClick}
      className="flex h-6 w-6 items-center justify-center rounded-md border border-border bg-background/90 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
    >
      {children}
      <span className="sr-only">{label}</span>
    </button>
  );
}
