const BAN_SEARCH_URL = "https://data.geopf.fr/geocodage/search";

export interface BanAddressSuggestion {
  label: string; // "8 Boulevard du Port 95000 Cergy"
  number: string | null; // numéro brut avant parsing BTQ, ex "8B" ou "8 BIS"
  btq: string | null; // bis/ter/quater/B/T/Q extrait si détecté, sinon null
  street: string | null;
  postcode: string | null;
  city: string | null;
  citycode: string | null;
  lat: number | null;
  lon: number | null;
  type: string; // "housenumber" | "street" | "locality" | "municipality"
  score: number;
}

interface BanFeature {
  properties: {
    label: string;
    housenumber?: string;
    street?: string;
    postcode?: string;
    citycode?: string;
    city?: string;
    type: string;
    score: number;
  };
  geometry: { type: "Point"; coordinates: [number, number] };
}

interface BanResponse {
  type: "FeatureCollection";
  features: BanFeature[];
}

/**
 * Scinde un housenumber BAN ("8B", "8 BIS", "12 ter") en {number, btq}.
 * Best-effort : si aucun suffixe reconnu n'est trouvé, number = valeur brute, btq = null.
 */
export function parseHouseNumber(raw: string | undefined | null): { number: string | null; btq: string | null } {
  if (!raw) return { number: null, btq: null };
  const trimmed = raw.trim();
  // Cas "8 BIS", "12 TER", "5 QUATER" (espace + mot)
  const wordMatch = trimmed.match(/^(\d+)\s*(bis|ter|quater|quinquies)$/i);
  if (wordMatch) {
    return { number: wordMatch[1], btq: wordMatch[2].toLowerCase() };
  }
  // Cas collé "8B", "12T" (lettre simple b/t/q en suffixe)
  const letterMatch = trimmed.match(/^(\d+)\s*([btq])$/i);
  if (letterMatch) {
    return { number: letterMatch[1], btq: letterMatch[2].toUpperCase() };
  }
  return { number: trimmed, btq: null };
}

export interface SearchBanAddressOptions {
  limit?: number;
  signal?: AbortSignal;
}

/**
 * Recherche d'adresses via l'API de géocodage de la Géoplateforme IGN (BAN).
 * Appel direct navigateur : CORS ouvert, pas de clé requise.
 * IMPORTANT : à debouncer côté appelant (rate limit ~1 req/s observé).
 */
export async function searchBanAddress(
  query: string,
  opts: SearchBanAddressOptions = {},
): Promise<BanAddressSuggestion[]> {
  const q = query.trim();
  if (q.length < 3) return [];

  const params = new URLSearchParams({
    q,
    limit: String(opts.limit ?? 5),
    autocomplete: "1",
  });

  const res = await fetch(`${BAN_SEARCH_URL}?${params.toString()}`, {
    signal: opts.signal,
  });
  if (!res.ok) throw new Error(`Erreur recherche adresse (${res.status})`);
  const data = (await res.json()) as BanResponse;

  return data.features.map((f) => {
    const { number, btq } = parseHouseNumber(f.properties.housenumber);
    return {
      label: f.properties.label,
      number,
      btq,
      street: f.properties.street ?? null,
      postcode: f.properties.postcode ?? null,
      city: f.properties.city ?? null,
      citycode: f.properties.citycode ?? null,
      lon: f.geometry.coordinates[0] ?? null,
      lat: f.geometry.coordinates[1] ?? null,
      type: f.properties.type,
      score: f.properties.score,
    };
  });
}
