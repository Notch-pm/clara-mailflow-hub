import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import { cn } from "@/lib/utils";

// Fix standard Vite : Leaflet auto-détecte le chemin de ses images via le tag
// <script> qui le charge, ce qui ne fonctionne pas avec un bundler — on
// supprime cette détection et on réimporte les icônes explicitement.
delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;

L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

interface AddressMapProps {
  lat: number;
  lon: number;
  label?: string;
  zoom?: number;
  className?: string;
}

/**
 * Carte de localisation d'une adresse. Fond de carte OpenStreetMap : libre
 * d'utilisation, gratuit, sans clé d'API (pas Google Maps).
 */
export default function AddressMap({ lat, lon, label, zoom = 16, className }: AddressMapProps) {
  return (
    // `isolate` crée un nouveau contexte d'empilement : les z-index internes
    // de Leaflet (panes/contrôles ~1000) restent confinés ici et ne peuvent
    // plus s'afficher au-dessus d'une modale ouverte par-dessus (Dialog z-50).
    <div className={cn("relative isolate h-64 w-full overflow-hidden rounded-md border", className)}>
      <MapContainer
        center={[lat, lon]}
        zoom={zoom}
        scrollWheelZoom={false}
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Marker position={[lat, lon]}>
          {label && <Popup>{label}</Popup>}
        </Marker>
      </MapContainer>
    </div>
  );
}
