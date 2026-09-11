// Propositions d'adresse pendant la frappe, géocodage d'une adresse écrite, et
// géocodage inverse pour « Utiliser ma position ». Toute la logique d'URL et de
// lecture vit dans `src/lib/adresse.ts` et `src/lib/carto.ts` (pures, testées).
// Ici : le rythme et le cache.
//
// L'assistance est un CONFORT : toute panne se traduit par une absence de
// propositions, jamais par une saisie bloquée.

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  addressSearchUrl,
  parseAddressSuggestions,
  reverseAddressUrl,
  SEARCH_DEBOUNCE_MS,
  type AddressSuggestion,
} from "@/lib/adresse";
import { geocodeUrl, parseGeocodeResponse, type GeoPoint } from "@/lib/carto";

const FIVE_MINUTES = 5 * 60 * 1000;
const ONE_DAY = 24 * 60 * 60 * 1000;

/**
 * Valeur retardée d'un délai. Le cache de TanStack Query dédoublonne déjà les
 * préfixes déjà tapés ; ce délai-ci évite d'ÉMETTRE la requête intermédiaire —
 * ce que le cache ne peut pas faire, et dont dépend le quota partagé de la
 * collectivité (une seule IP publique pour tous les agents).
 */
function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export interface AddressSuggestionsResult {
  suggestions: AddressSuggestion[];
  /** Une requête est en vol pour une saisie qui n'a pas encore de réponse. */
  isLoading: boolean;
  /** Le service n'a pas répondu — à dire discrètement, jamais à bloquer. */
  isError: boolean;
  /** La frappe est en avance sur les propositions affichées. */
  isStale: boolean;
}

export function useAddressSuggestions(query: string, enabled = true): AddressSuggestionsResult {
  const debounced = useDebounced(query, SEARCH_DEBOUNCE_MS);
  const url = enabled ? addressSearchUrl(debounced) : null;

  const result = useQuery({
    queryKey: ["address-suggestions", url],
    enabled: url !== null,
    staleTime: FIVE_MINUTES,
    gcTime: FIVE_MINUTES,
    // Pendant la frappe, un échec se remplace tout seul au caractère suivant :
    // réessayer ajouterait des appels là où le quota est déjà le sujet.
    retry: false,
    queryFn: async ({ signal }): Promise<AddressSuggestion[]> => {
      const response = await fetch(url!, { signal, headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return parseAddressSuggestions(await response.json());
    },
  });

  return {
    suggestions: result.data ?? [],
    isLoading: result.isFetching,
    isError: result.isError,
    isStale: debounced !== query,
  };
}

/**
 * Point d'une adresse ÉCRITE (sans proposition retenue). Confort d'affichage,
 * jamais une donnée de la demande : rien n'est envoyé au serveur, le point
 * n'est mis en cache que le temps de la session.
 */
export function useGeocode(query: string, postcode: string | null) {
  const url = geocodeUrl(query, postcode);
  return useQuery({
    queryKey: ["geocode", url],
    enabled: url !== null,
    staleTime: ONE_DAY,
    gcTime: ONE_DAY,
    retry: 1,
    queryFn: async ({ signal }): Promise<GeoPoint | null> => {
      const response = await fetch(url!, { signal, headers: { Accept: "application/json" } });
      if (!response.ok) {
        throw new Error(`Service de localisation indisponible (HTTP ${response.status}).`);
      }
      return parseGeocodeResponse(await response.json());
    },
  });
}

/** Le géocodage inverse est-il disponible sur le service configuré ? */
export function reverseGeocodingAvailable(): boolean {
  return reverseAddressUrl(0, 0) !== null;
}

/**
 * Adresse la plus proche d'un point. Utilisé une fois, sur clic — pas de hook
 * de requête : il n'y a rien à mettre en cache, la position change à chaque appel.
 */
export async function reverseGeocode(
  lat: number,
  lon: number,
  signal?: AbortSignal,
): Promise<AddressSuggestion | null> {
  const url = reverseAddressUrl(lat, lon);
  if (!url) return null;
  const response = await fetch(url, { signal, headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return parseAddressSuggestions(await response.json())[0] ?? null;
}

export interface BrowserPosition {
  lat: number;
  lon: number;
}

/**
 * Position du navigateur, en promesse. Refus de permission, service absent ou
 * délai dépassé rendent `null` : l'appelant n'affiche pas d'erreur — l'agent
 * n'a rien fait de mal.
 */
export function browserPosition(timeoutMs = 10_000): Promise<BrowserPosition | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: position.coords.latitude, lon: position.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
    );
  });
}
