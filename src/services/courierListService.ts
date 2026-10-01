import { supabase } from "@/integrations/supabase/client";
import type { CourierDirection, CourierChannel } from "@/types/courier";

/**
 * Accès paginé aux listes de courriers, via le RPC `search_couriers`.
 *
 * Les pages de liste filtraient auparavant en JavaScript APRÈS un LIMIT serveur :
 * choisir un service ou un tag ne cherchait que dans les 50 à 200 lignes déjà
 * chargées. Tout est désormais poussé en SQL, ce qui rend les listes justes et
 * permet de paginer sur un total exact (`total_count`, calculé par
 * `COUNT(*) OVER()` avant le découpage).
 */

/**
 * Colonnes sur lesquelles le RPC sait trier (cf. `p_sort_by`).
 *
 * Toutes natives de `couriers`. Expéditeur, destinataire et état en sont
 * volontairement absents : ils proviennent de jointures que le RPC applique
 * APRÈS le découpage, sur la seule page retenue. Les trier obligerait à les
 * calculer sur tout le jeu filtré — le coût même que la pagination économise.
 * Les pages laissent donc ces colonnes non triables (`enableSorting: false`).
 *
 * Ces identifiants servent aussi d'`id` de colonne côté tableau : c'est ce qui
 * dispense d'une table de correspondance entre en-tête cliqué et clé serveur.
 */
export const COURIER_SORT_KEYS = [
  "received_at",
  "sent_at",
  "created_at",
  "updated_at",
  "chrono",
  "subject",
  "assigned_service",
] as const;

export type CourierSortKey = (typeof COURIER_SORT_KEYS)[number];

export type CourierSortDir = "asc" | "desc";

export function isCourierSortKey(value: string): value is CourierSortKey {
  return (COURIER_SORT_KEYS as readonly string[]).includes(value);
}

export interface CourierListFilters {
  organizationId: string;
  direction?: CourierDirection | null;
  /** Ensemble d'états (une catégorie de workflow). */
  workflowStateIds?: string[] | null;
  /** Inclure les courriers sans état — la boîte aux lettres en a besoin. */
  includeNullState?: boolean;
  /** Choix de l'utilisateur dans le menu « Service » : correspondance exacte. */
  socleOrganizationId?: string | null;
  /**
   * Périmètre RBAC de l'utilisateur, tel que renvoyé par `useUserServiceFilter()` :
   * `null` = aucune restriction (admin/superadmin), sinon la liste des
   * organisations autorisées (les courriers non assignés restent visibles de tous).
   *
   * Champ volontairement OBLIGATOIRE et non optionnel : le typage force chaque
   * appelant à se prononcer. L'oublier réintroduirait la fuite que ce service
   * referme — la RLS de `couriers` ne filtre qu'au niveau du tenant, pas du service.
   */
  visibleSocleOrganizationIds: string[] | null;
  keywords?: string | null;
  /**
   * Recherche par préfixe (« raccord » trouve « raccordement »), comportement
   * historique des listes. La page Recherche laisse `false` pour conserver la
   * syntaxe `websearch` (guillemets, OR, -).
   */
  prefixMatch?: boolean;
  tagNames?: string[] | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  /** `true` = seulement les transférés, `false` = seulement les non transférés. */
  transferredOnly?: boolean | null;
  sortBy?: CourierSortKey;
  /** Défaut `desc` côté RPC. Les valeurs manquantes finissent en bas dans les deux sens. */
  sortDir?: CourierSortDir;
}

/** Une ligne telle que renvoyée par le RPC (à plat, déjà dénormalisée). */
export interface CourierListRow {
  id: string;
  subject: string | null;
  direction: CourierDirection;
  channel: CourierChannel | null;
  chrono: string | null;
  received_at: string | null;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
  workflow_state_id: string | null;
  assigned_service: string | null;
  socle_organization_id: string | null;
  organization_id: string;
  sender_name: string | null;
  sender_first_name: string | null;
  sender_last_name: string | null;
  recipient_name: string | null;
  tags: string[];
  is_transferred: boolean;
  /** Courrier reçu au-delà du seuil « volumineux » (2 Mo) — typiquement un scan. */
  is_large_email: boolean;
  /** Première réponse envoyée — posée par trigger (`couriers_track_acknowledgement`). */
  acknowledged_at: string | null;
  /** Entrée dans un état clos, `null` s'il en est ressorti (`couriers_track_resolution`). */
  resolved_at: string | null;
  match_in: string[];
  total_count: number;
}

export interface CourierListPage {
  rows: CourierListRow[];
  totalCount: number;
  pageCount: number;
}

/**
 * Préfixes de queryKey des listes paginées, un par écran.
 *
 * À utiliser pour invalider « toutes les listes » depuis un composant qui ne
 * sait pas laquelle est affichée. Un `invalidateQueries({ queryKey: ["couriers"] })`
 * ne fonctionne pas : TanStack Query compare élément par élément, et
 * `["couriers-inbound", …]` ne correspond pas à `["couriers"]`.
 */
export const COURIER_LIST_QUERY_PREFIXES = [
  "mailbox-couriers",
  "instruction-couriers",
  "traites-couriers",
  "archives-couriers",
  "couriers-inbound",
  "couriers-outbound",
] as const;

/** Taille de page utilisée pour rapatrier l'intégralité d'un filtre (export CSV). */
export const EXPORT_PAGE_SIZE = 500;
/** Garde-fou : au-delà, l'export est tronqué et l'appelant en avertit l'utilisateur. */
export const EXPORT_MAX_ROWS = 20_000;

/**
 * `types.ts` est généré et ne connaît pas encore la nouvelle signature du RPC :
 * on la décrit localement plutôt que de caster en `any`. À supprimer à la
 * prochaine régénération des types.
 */
type SearchCouriersRpc = (
  fn: "search_couriers",
  params: Record<string, unknown>,
) => Promise<{ data: CourierListRow[] | null; error: { message: string } | null }>;

/**
 * Le cast est résolu à CHAQUE appel, et non capturé au chargement du module :
 * une référence figée échapperait au mock des tests, qui remplace `supabase.rpc`
 * après l'import.
 */
function callSearchCouriers(params: Record<string, unknown>) {
  return (supabase as unknown as { rpc: SearchCouriersRpc }).rpc("search_couriers", params);
}

function rpcParams(filters: CourierListFilters, limit: number, offset: number) {
  return {
    p_organization_id: filters.organizationId,
    p_direction: filters.direction ?? null,
    p_workflow_state_id: null,
    p_socle_organization_id: filters.socleOrganizationId ?? null,
    p_keywords: filters.keywords?.trim() || null,
    p_tag_names: filters.tagNames?.length ? filters.tagNames : null,
    p_date_from: filters.dateFrom ?? null,
    p_date_to: filters.dateTo ?? null,
    p_limit: limit,
    p_offset: offset,
    p_workflow_state_ids: filters.workflowStateIds?.length ? filters.workflowStateIds : null,
    p_include_null_state: filters.includeNullState ?? false,
    // `?? null` et non `|| null` : un tableau vide est significatif (utilisateur
    // rattaché à aucun service ⇒ seuls les courriers non assignés).
    p_visible_socle_organization_ids: filters.visibleSocleOrganizationIds ?? null,
    p_sort_by: filters.sortBy ?? "received_at",
    p_sort_dir: filters.sortDir ?? "desc",
    p_prefix_match: filters.prefixMatch ?? false,
    p_transferred_only: filters.transferredOnly ?? null,
  };
}

export async function fetchCourierListPage(
  filters: CourierListFilters,
  page: number,
  pageSize: number,
): Promise<CourierListPage> {
  const { data, error } = await callSearchCouriers(rpcParams(filters, pageSize, page * pageSize));
  if (error) throw error;

  const rows = data ?? [];
  // total_count est répété sur chaque ligne ; une page vide signifie 0 résultat.
  const totalCount = rows[0]?.total_count ?? 0;
  return { rows, totalCount, pageCount: Math.max(1, Math.ceil(totalCount / pageSize)) };
}

/**
 * Rapatrie tout le jeu filtré, par blocs, pour l'export CSV.
 *
 * Prend les MÊMES `CourierListFilters` que le tableau : ce qui est exporté est
 * exactement ce qui est affiché. Auparavant l'export passait par un helper qui
 * ignorait service/état/tag, obligeant chaque page à refiltrer en JS.
 */
export async function fetchAllCouriersForExport(
  filters: CourierListFilters,
): Promise<{ rows: CourierListRow[]; truncated: boolean }> {
  const all: CourierListRow[] = [];
  for (let offset = 0; offset < EXPORT_MAX_ROWS; offset += EXPORT_PAGE_SIZE) {
    const { data, error } = await callSearchCouriers(rpcParams(filters, EXPORT_PAGE_SIZE, offset));
    if (error) throw error;
    const page = data ?? [];
    all.push(...page);
    if (page.length < EXPORT_PAGE_SIZE) return { rows: all, truncated: false };
  }
  return { rows: all, truncated: true };
}
