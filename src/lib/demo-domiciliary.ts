import { useCallback, useSyncExternalStore } from "react";

/**
 * Fichier domiciliaire — MODE DÉMO, 100 % front.
 *
 * La fonctionnalité réelle a quitté Clara le 2026-07-16 (contacts délégués au
 * référentiel) ; cette version de démonstration n'écrit RIEN en base ni dans le
 * référentiel : l'activation et les fiches saisies vivent dans le localStorage
 * du navigateur, et les fiches non saisies sont générées de façon déterministe
 * à partir de l'id du contact (mêmes valeurs à chaque affichage).
 */

export type FamilyStatus = "celibataire" | "marie" | "pacse" | "divorce" | "inconnu";

export const FAMILY_STATUS_LABELS: Record<FamilyStatus, string> = {
  celibataire: "Célibataire",
  marie: "Marié(e)",
  pacse: "Pacsé(e)",
  divorce: "Divorcé(e)",
  inconnu: "Inconnu",
};

export interface DomiciliaryRecord {
  usual_name: string | null;
  birth_date: string | null;
  death_date: string | null;
  family_status: FamilyStatus | null;
  marriage_date: string | null;
  pacs_date: string | null;
  nationality: string | null;
  phone_2: string | null;
  arrival_date: string | null;
  departure_date: string | null;
  address_number: string | null;
  address_btq: string | null;
  address_street: string | null;
  address_building: string | null;
  address_apartment: string | null;
  address_complement: string | null;
  address_postal_code: string | null;
  address_city: string | null;
}

/** Champs du contact référentiel réutilisés pour garder la fiche mock cohérente. */
export interface DomiciliarySource {
  id: string;
  usage_name?: string | null;
  birth_date?: string | null;
  address_line1?: string | null;
  postal_code?: string | null;
  city?: string | null;
}

// ── Activation (par tenant, localStorage) ───────────────────────────────────

const FLAG_EVENT = "clara-demo-domiciliary-flag";

function flagKey(orgId: string): string {
  return `clara-demo.domiciliary.enabled.${orgId}`;
}

function recordKey(contactId: string): string {
  return `clara-demo.domiciliary.record.${contactId}`;
}

export function isDomiciliaryFileEnabled(orgId: string | null | undefined): boolean {
  if (!orgId) return false;
  try {
    return localStorage.getItem(flagKey(orgId)) === "1";
  } catch {
    return false;
  }
}

export function setDomiciliaryFileEnabled(orgId: string, enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(flagKey(orgId), "1");
    else localStorage.removeItem(flagKey(orgId));
    window.dispatchEvent(new Event(FLAG_EVENT));
  } catch {
    // Stockage indisponible (navigation privée…) : le mode reste désactivé.
  }
}

/** Réactif au toggle dans la même page et aux changements d'un autre onglet. */
export function useDomiciliaryFileMode(orgId: string | null | undefined): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    window.addEventListener(FLAG_EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(FLAG_EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);
  return useSyncExternalStore(subscribe, () => isDomiciliaryFileEnabled(orgId));
}

// ── Grands anniversaires ────────────────────────────────────────────────────

export const MILESTONE_AGES = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100] as const;

/** Âge rond (10, 20, … 100 ans) atteint dans l'année civile, sinon null. */
export function milestoneAgeThisYear(
  dateStr: string | null | undefined,
  year: number = new Date().getFullYear(),
): number | null {
  if (!dateStr) return null;
  const born = Number.parseInt(dateStr.slice(0, 4), 10);
  if (!Number.isFinite(born)) return null;
  const age = year - born;
  return (MILESTONE_AGES as readonly number[]).includes(age) ? age : null;
}

// ── Fiche domiciliaire d'un contact : saisie (localStorage) ou mock ─────────

export function getDomiciliaryRecord(source: DomiciliarySource): DomiciliaryRecord {
  try {
    const raw = localStorage.getItem(recordKey(source.id));
    if (raw) return { ...mockDomiciliaryRecord(source), ...(JSON.parse(raw) as Partial<DomiciliaryRecord>) };
  } catch {
    // JSON invalide ou stockage indisponible : on retombe sur le mock.
  }
  return mockDomiciliaryRecord(source);
}

export function saveDomiciliaryRecord(contactId: string, record: DomiciliaryRecord): void {
  try {
    localStorage.setItem(recordKey(contactId), JSON.stringify(record));
  } catch {
    // Stockage indisponible : la saisie ne survivra pas au rechargement.
  }
}

// ── Génération déterministe ─────────────────────────────────────────────────

function hashSeed(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** PRNG mulberry32 : séquence stable pour une même graine (id du contact). */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STREETS = [
  "Rue de la République",
  "Boulevard des Lices",
  "Rue du Cloître",
  "Avenue Victor Hugo",
  "Rue Gambetta",
  "Boulevard Émile Combes",
  "Rue de la Cavalerie",
  "Avenue de Camargue",
  "Rue du Quatre-Septembre",
  "Place de la Major",
  "Chemin de Barriol",
  "Avenue Sadi Carnot",
];

const BUILDINGS = ["Résidence les Alyscamps", "Résidence du Forum", "Le Trébon", "Les Mouleyrès"];

const NATIONALITIES = ["Italienne", "Espagnole", "Portugaise", "Marocaine", "Belge"];

const FAMILY_STATUSES: { value: FamilyStatus; weight: number }[] = [
  { value: "marie", weight: 0.35 },
  { value: "celibataire", weight: 0.3 },
  { value: "pacse", weight: 0.15 },
  { value: "divorce", weight: 0.1 },
  { value: "inconnu", weight: 0.1 },
];

function pickWeighted(rand: () => number): FamilyStatus {
  let r = rand();
  for (const { value, weight } of FAMILY_STATUSES) {
    if (r < weight) return value;
    r -= weight;
  }
  return "inconnu";
}

function iso(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function randomDate(rand: () => number, minYear: number, maxYear: number): string {
  const year = minYear + Math.floor(rand() * Math.max(1, maxYear - minYear + 1));
  return iso(year, 1 + Math.floor(rand() * 12), 1 + Math.floor(rand() * 28));
}

function pair(rand: () => number): string {
  return String(10 + Math.floor(rand() * 90));
}

export function mockDomiciliaryRecord(source: DomiciliarySource): DomiciliaryRecord {
  const rand = mulberry32(hashSeed(source.id));

  const birth = source.birth_date || randomDate(rand, 1938, 2002);
  const birthYear = Number.parseInt(birth.slice(0, 4), 10) || 1970;
  const family = pickWeighted(rand);

  // Dates d'union cohérentes avec la naissance (et le Pacs n'existe que depuis 1999).
  // Un mariage sur deux tombe sur un anniversaire rond dans l'année, pour que le
  // filtre « grands anniversaires de mariage » ait des résultats à montrer.
  let unionDate = randomDate(rand, birthYear + 22, Math.min(birthYear + 45, 2024));
  const nowYear = new Date().getFullYear();
  const milestoneChoices = [10, 20, 30, 40, 50].filter((a) => nowYear - a >= birthYear + 20);
  if (milestoneChoices.length > 0 && rand() < 0.5) {
    const age = milestoneChoices[Math.floor(rand() * milestoneChoices.length)];
    unionDate = iso(nowYear - age, 1 + Math.floor(rand() * 12), 1 + Math.floor(rand() * 28));
  }
  const pacsDate = unionDate >= "2000-01-01" ? unionDate : randomDate(rand, 2000, 2024);

  const arrivalMin = Math.max(birthYear + 18, 1995);
  const arrival = randomDate(rand, arrivalMin, 2024);
  const departure =
    rand() < 0.08 ? randomDate(rand, Number.parseInt(arrival.slice(0, 4), 10) + 1, 2025) : null;

  // Adresse : on décompose celle du référentiel quand elle existe, sinon mock.
  const parsed = /^\s*(\d+)\s*(bis|ter|quater)?\s*,?\s+(.{3,})$/i.exec(source.address_line1 ?? "");
  const number = parsed ? parsed[1] : String(1 + Math.floor(rand() * 120));
  const btq = parsed
    ? (parsed[2]?.toLowerCase() ?? null)
    : rand() < 0.08
      ? "bis"
      : rand() < 0.03
        ? "ter"
        : null;
  const street = parsed ? parsed[3] : STREETS[Math.floor(rand() * STREETS.length)];
  const building = rand() < 0.2 ? BUILDINGS[Math.floor(rand() * BUILDINGS.length)] : null;
  const apartment = building && rand() < 0.7 ? `Appt ${1 + Math.floor(rand() * 45)}` : null;

  return {
    usual_name: source.usage_name ?? null,
    birth_date: birth,
    death_date: null,
    family_status: family,
    marriage_date: family === "marie" ? unionDate : null,
    pacs_date: family === "pacse" ? pacsDate : null,
    nationality: rand() < 0.8 ? "Française" : NATIONALITIES[Math.floor(rand() * NATIONALITIES.length)],
    phone_2: rand() < 0.4 ? `04 90 ${pair(rand)} ${pair(rand)} ${pair(rand)}` : null,
    arrival_date: arrival,
    departure_date: departure,
    address_number: number,
    address_btq: btq,
    address_street: street,
    address_building: building,
    address_apartment: apartment,
    address_complement: rand() < 0.1 ? "Fond de cour" : null,
    address_postal_code: source.postal_code || "13200",
    address_city: source.city || "Arles",
  };
}
