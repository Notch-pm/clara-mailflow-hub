// Recherche globale du tableau de bord — LOGIQUE PURE (sans DOM ni réseau), testée.
//
// Deux natures, deux sources qu'aucun serveur ne joint (même partage que la
// fiche contact) : les COURRIERS sont des données Clara (RPC `search_couriers`,
// borné au tenant par la RLS et au périmètre de l'agent par
// `useUserServiceFilter`) ; les USAGERS vivent dans le Socle, servis par
// l'edge function `socle-contacts`.
//
// Le regroupement, les libellés et le parcours au clavier se décident ici ; le
// composant ne fait qu'afficher. Même découpage qu'Iris
// (`src/features/search/search.ts`) : c'est la même barre dans la même gamme,
// un agent qui passe d'un produit à l'autre doit la retrouver à l'identique.

import { courierSenderName } from "@/components/courier/courierListColumns";
import type { StatusTone } from "@/components/list/ListCells";
import type { Database } from "@/integrations/supabase/types";
import type { CourierListRow } from "@/services/courierListService";
import {
  SOCLE_CONTACT_TYPE_LABELS,
  type SocleContact,
} from "@/services/socleContactService";

type WorkflowCategory = Database["public"]["Enums"]["workflow_category"];

/** En deçà, on ne cherche pas : deux caractères ramèneraient tout le tenant. */
export const MIN_QUERY_LENGTH = 3;

/**
 * Temporisation de la frappe. Le cache de TanStack Query dédoublonne les
 * préfixes déjà tapés ; ce délai-ci évite d'ÉMETTRE la requête intermédiaire —
 * ce que le cache ne peut pas faire, et qui coûterait un aller-retour par
 * caractère (dont un appel au Socle).
 */
export const SEARCH_DEBOUNCE_MS = 300;

/** Ce que la barre montre par nature — au-delà, on passe à la page Recherche. */
export const RESULTS_PER_KIND = 6;

/** Teinte de l'état selon sa catégorie : à traiter, traité, archivé. */
export const CATEGORY_TONE: Record<WorkflowCategory, StatusTone> = {
  pending: "warning",
  processing: "warning",
  processed: "primary",
  archived: "muted",
};

// ---- Saisie -----------------------------------------------------------------

/** Saisie ramenée à sa forme cherchée : taillée, espaces internes recollés. */
export function normalizeQuery(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

export function isSearchable(raw: string): boolean {
  return normalizeQuery(raw).length >= MIN_QUERY_LENGTH;
}

// La saisie part TELLE QUELLE aux deux sources : `search_couriers` normalise et
// échappe côté SQL (`p_prefix_match`, recherche plein texte), le Socle fait de
// même sur son `search`. Aucun jumeau JavaScript de cette normalisation ici —
// il aurait divergé du serveur sur « cœur » ou « ß », et une recherche qui ne
// trouve rien ne dit jamais pourquoi.

// ---- Résultats --------------------------------------------------------------

export interface CourierResult {
  kind: "courrier";
  id: string;
  href: string;
  /** Référence séquentielle annuelle, vide si le courrier n'en porte pas. */
  chrono: string;
  subject: string;
  /** « Entrant » / « Sortant ». */
  direction: string;
  /** Libellé de l'état, vide tant que le courrier n'est pas pris en charge. */
  stateLabel: string;
  stateTone: StatusTone;
  /** Date de réception (entrant) ou d'envoi (sortant), au format français. */
  date: string;
  /** Expéditeur, ou « Expéditeur inconnu ». */
  sender: string;
  /** Organisation gestionnaire telle qu'affichée dans les listes, ou « — ». */
  service: string;
  /**
   * Où la correspondance a été trouvée (« objet », « corps »…) : c'est ce qui
   * explique un résultat dont le titre ne contient pas le mot cherché.
   */
  matchIn: string[];
}

export interface UsagerResult {
  kind: "usager";
  id: string;
  href: string;
  /** Nom d'affichage composé par le Socle. */
  name: string;
  /** « Personne », « Entreprise »… */
  typeLabel: string;
  /** Ville de l'adresse — vide si le référentiel n'en porte pas. */
  city: string;
  /** Courriel du référentiel — ce qui départage deux homonymes. */
  email: string;
}

export type SearchResult = CourierResult | UsagerResult;

export type GroupKey = "courriers" | "usagers";

export interface SearchGroup {
  key: GroupKey;
  label: string;
  results: SearchResult[];
}

const DIRECTION_LABELS: Record<string, string> = {
  inbound: "Entrant",
  outbound: "Sortant",
  incoming: "Entrant",
  outgoing: "Sortant",
};

/** Mêmes libellés que la page Recherche — « objet », « corps », « documents »… */
const MATCH_IN_LABELS: Record<string, string> = {
  subject: "objet",
  body: "corps",
  participants: "participants",
  documents: "documents",
};

/** « 12/08/2026 » — date telle qu'elle se lit dans les listes. */
export function frDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("fr-FR");
}

export function toCourierResult(
  row: CourierListRow,
  stateOf: (id: string) => { name: string; category: WorkflowCategory } | undefined,
): CourierResult {
  const state = row.workflow_state_id ? stateOf(row.workflow_state_id) : undefined;
  const sender = courierSenderName(row).trim();
  return {
    kind: "courrier",
    id: row.id,
    href: `/courrier/${row.id}`,
    chrono: row.chrono ?? "",
    subject: row.subject?.trim() || "(sans objet)",
    direction: DIRECTION_LABELS[row.direction] ?? row.direction,
    stateLabel: state?.name ?? "",
    stateTone: state ? CATEGORY_TONE[state.category] ?? "muted" : "muted",
    date: frDate(row.received_at ?? row.sent_at ?? row.created_at),
    sender: sender || "Expéditeur inconnu",
    service: row.assigned_service?.trim() || "—",
    matchIn: (row.match_in ?? []).map((m) => MATCH_IN_LABELS[m] ?? m),
  };
}

export function toUsagerResult(contact: SocleContact): UsagerResult {
  return {
    kind: "usager",
    id: contact.id,
    href: `/contacts/${contact.id}`,
    name: contact.display_name?.trim() || "Sans nom",
    typeLabel: SOCLE_CONTACT_TYPE_LABELS[contact.contact_type] ?? contact.contact_type,
    city: contact.city?.trim() ?? "",
    email: contact.email?.trim() ?? "",
  };
}

/**
 * Groupes affichés, dans cet ordre : courriers puis usagers (l'agent cherche
 * d'abord un dossier). Un groupe vide n'apparaît pas — un en-tête sans ligne
 * ferait croire à une recherche en cours.
 */
export function buildGroups(
  couriers: readonly CourierListRow[],
  contacts: readonly SocleContact[],
  stateOf: (id: string) => { name: string; category: WorkflowCategory } | undefined,
): SearchGroup[] {
  const groups: SearchGroup[] = [];
  if (couriers.length > 0) {
    groups.push({
      key: "courriers",
      label: "Courriers",
      results: couriers.map((row) => toCourierResult(row, stateOf)),
    });
  }
  if (contacts.length > 0) {
    groups.push({
      key: "usagers",
      label: "Usagers",
      results: contacts.map(toUsagerResult),
    });
  }
  return groups;
}

/** Ordre de parcours au clavier : les groupes mis bout à bout. */
export function flattenResults(groups: readonly SearchGroup[]): SearchResult[] {
  return groups.flatMap((group) => group.results);
}

/** ↑ ↓ circulaires (motif `AddressField`) ; liste vide ⇒ aucun index. */
export function moveIndex(current: number, delta: number, count: number): number {
  if (count <= 0) return 0;
  return (((current + delta) % count) + count) % count;
}
