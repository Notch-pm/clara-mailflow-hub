// Saisie d'adresse assistée — logique PURE (ni DOM ni réseau), testée.
//
// Portée d'Iris (`src/lib/adresse.ts` du dépôt iris) : une adresse saisie dans
// Clara doit se proposer, se découper et se lire EXACTEMENT comme dans Iris,
// puisque c'est Iris qui l'instruira.
//
// Même service que `carto.ts` — la Base Adresse Nationale (Géoplateforme/IGN),
// publique, sans clé —, ouvert ici à un usage que `carto.ts` ne couvre pas :
// proposer pendant la frappe (`autocomplete=1`) au lieu de résoudre une adresse
// déjà écrite.
//
// Ce qui transite : le fragment d'adresse tapé, et rien d'autre — jamais un
// nom, jamais une référence de courrier.

import { CARTO, precisionOf, type GeoPrecision } from "./carto";

/** En deçà, la BAN rend du bruit : on ne l'interroge pas. */
export const MIN_QUERY_LENGTH = 3;
/** Au-delà, la liste ne se lit plus d'un coup d'œil. */
export const SUGGESTION_LIMIT = 5;
/**
 * Une collectivité sort par UNE adresse IP : sans ce délai, dix agents qui
 * tapent ensemble saturent le quota partagé du service.
 */
export const SEARCH_DEBOUNCE_MS = 300;

export interface AddressSuggestion {
  /** Identifiant BAN de l'adresse — clé de liste, jamais stockée. */
  id: string;
  /** Adresse complète telle que la BAN la comprend : « 10 Avenue de Frémeur 44000 Nantes ». */
  label: string;
  /** Ligne de voie seule : « 10 Avenue de Frémeur », ou la voie sans numéro. */
  name: string;
  /** Numéro tel quel, « 10 » ou « 10 bis » (voir `splitHouseNumber`). */
  housenumber: string;
  street: string;
  postcode: string;
  city: string;
  citycode: string;
  /** « 44, Loire-Atlantique, Pays de la Loire ». */
  context: string;
  precision: GeoPrecision;
  /** Score BAN : classement RELATIF à la réponse, jamais une probabilité. */
  score: number;
  lat: number;
  lon: number;
}

// ── URL ─────────────────────────────────────────────────────────────────────

/** Recherche pendant la frappe — `null` si la requête est trop courte pour être posée. */
export function addressSearchUrl(query: string, base = CARTO.geocodeUrl): string | null {
  const q = query.trim();
  if (q.length < MIN_QUERY_LENGTH) return null;
  const url = new URL(base);
  url.searchParams.set("q", q);
  url.searchParams.set("limit", String(SUGGESTION_LIMIT));
  url.searchParams.set("autocomplete", "1");
  return url.toString();
}

/**
 * Point d'entrée du géocodage inverse, déduit de celui de la recherche.
 * `null` quand la base configurée n'est pas un `…/search/` : un endpoint
 * substitué n'expose pas forcément l'inverse, et mieux vaut retirer le bouton
 * « Utiliser ma position » que composer une URL au hasard.
 */
export function reverseAddressUrl(lat: number, lon: number, base = CARTO.geocodeUrl): string | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const reverseBase = base.replace(/search\/?$/, "reverse/");
  if (reverseBase === base) return null;
  const url = new URL(reverseBase);
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lon));
  url.searchParams.set("limit", "1");
  return url.toString();
}

// ── Lecture de la réponse ───────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Lecture TOLÉRANTE du GeoJSON BAN : champs inconnus ignorés, entrée illisible
 * sautée, réponse informe → liste vide. Jamais d'exception — l'assistance est
 * un confort, sa panne ne doit pas empêcher de saisir.
 */
export function parseAddressSuggestions(raw: unknown): AddressSuggestion[] {
  if (!isRecord(raw) || !Array.isArray(raw.features)) return [];
  const out: AddressSuggestion[] = [];
  for (const feature of raw.features) {
    if (!isRecord(feature)) continue;
    const geometry = isRecord(feature.geometry) ? feature.geometry : null;
    const coordinates = geometry && Array.isArray(geometry.coordinates) ? geometry.coordinates : null;
    if (!coordinates || coordinates.length < 2) continue;
    const [lon, lat] = coordinates;
    if (typeof lon !== "number" || typeof lat !== "number") continue;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;

    const p = isRecord(feature.properties) ? feature.properties : {};
    const label = text(p.label);
    if (label === "") continue; // sans libellé, la proposition n'est pas choisissable
    out.push({
      id: text(p.id) || label,
      label,
      name: text(p.name) || label,
      housenumber: text(p.housenumber),
      street: text(p.street),
      postcode: text(p.postcode),
      city: text(p.city),
      citycode: text(p.citycode),
      context: text(p.context),
      precision: precisionOf(typeof p.type === "string" ? p.type : undefined),
      score: typeof p.score === "number" ? p.score : 0,
      lat,
      lon,
    });
  }
  return out;
}

// ── Découpage vers les champs du bloc « Lieu d'intervention » ───────────────

/** Bis, ter, quater… et les indices à une lettre (« 2 A »). */
const BTQ_WORDS = new Set(["bis", "ter", "quater", "quinquies"]);

function isBtq(word: string): boolean {
  const w = word.toLowerCase().replace(/[.,]/g, "");
  return BTQ_WORDS.has(w) || /^[a-z]$/.test(w);
}

/**
 * « 10 bis » → numéro « 10 », BTQ « bis ». Le bloc du Socle sépare les deux, la
 * BAN les rend collés. Sans ce découpage, le BTQ resterait vide et le numéro
 * porterait un texte que personne n'attend là.
 *
 * Ce qui ne commence pas par un nombre est rendu tel quel en numéro : la BAN
 * met parfois autre chose dans `housenumber`, et le perdre serait pire.
 */
export function splitHouseNumber(housenumber: string): { numero: string; btq: string } {
  const value = housenumber.trim();
  const match = /^(\d+)\s*(.*)$/.exec(value);
  if (!match) return { numero: value, btq: "" };
  return { numero: match[1], btq: match[2].trim() };
}

/**
 * Découpe une ligne de voie SAISIE À LA MAIN : « 10 bis Avenue de Frémeur » →
 * numéro / BTQ / voie. Sert quand l'agent tape sans retenir de proposition —
 * sans elle, toute la ligne atterrirait dans « Voie » et le numéro serait perdu
 * pour le géocodage comme pour l'intervention.
 */
export function splitStreetLine(line: string): { numero: string; btq: string; voie: string } {
  const value = line.trim().replace(/\s+/g, " ");
  const match = /^(\d+)\s*(.*)$/.exec(value);
  if (!match) return { numero: "", btq: "", voie: value };
  const rest = match[2];
  const words = rest === "" ? [] : rest.split(" ");
  if (words.length > 0 && isBtq(words[0])) {
    return { numero: match[1], btq: words[0], voie: words.slice(1).join(" ") };
  }
  return { numero: match[1], btq: "", voie: rest };
}

/** Recompose la ligne unique depuis les champs séparés du bloc d'intervention. */
export function streetLine(parts: { numero: string; btq: string; voie: string }): string {
  return [parts.numero, parts.btq, parts.voie]
    .map((p) => p.trim())
    .filter((p) => p !== "")
    .join(" ");
}

/** Champs du bloc « Lieu d'intervention » qu'une suggestion peut remplir. */
export type StreetPart = "numero" | "btq" | "voie" | "code_postal" | "ville";

/**
 * Projection d'une proposition vers le bloc « Lieu d'intervention ». Ne remplit
 * JAMAIS `complement`, `appartement` ni `batiment` : ce sont des précisions
 * d'accès que le géocodeur ignore, et que l'agent seul connaît.
 */
export function toInterventionParts(s: AddressSuggestion): Record<StreetPart, string> {
  const { numero, btq } = splitHouseNumber(s.housenumber);
  return {
    numero,
    btq,
    // Sans numéro, la BAN met le libellé de voie dans `name` et laisse `street` vide.
    voie: s.street || (s.housenumber === "" ? s.name : ""),
    code_postal: s.postcode,
    ville: s.city,
  };
}

/** Seconde ligne d'une proposition : le contexte départemental, à défaut la commune. */
export function suggestionContext(s: AddressSuggestion): string {
  return s.context || [s.postcode, s.city].filter((v) => v !== "").join(" ");
}
