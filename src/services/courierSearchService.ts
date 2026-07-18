import { fetchCourierListPage } from "@/services/courierListService";

/**
 * Recherche avancée de courriers (page Recherche).
 *
 * Adaptateur mince au-dessus de `courierListService`, qui détient désormais le
 * seul binding vers le RPC `search_couriers`. Les types exportés ici sont
 * conservés tels quels : `RechercheCourrierPage` compile sans modification.
 */

export interface CourierSearchParams {
  organizationId: string;
  direction?: "inbound" | "outbound" | null;
  workflowStateId?: string | null;
  /** UUID de l'organisation gestionnaire (miroir Socle). */
  socleOrganizationId?: string | null;
  /**
   * Périmètre RBAC (`useUserServiceFilter()`). Appliqué en SQL : la page le
   * filtrait auparavant en JS APRÈS la pagination, ce qui faussait le total
   * affiché et faisait sauter des lignes dans le défilement infini.
   */
  visibleSocleOrganizationIds: string[] | null;
  keywords?: string | null;
  tagNames?: string[] | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  limit?: number;
  offset?: number;
}

export interface CourierSearchResult {
  id: string;
  subject: string;
  direction: string;
  received_at: string;
  workflow_state_id: string | null;
  assigned_service: string | null;
  socle_organization_id: string | null;
  organization_id: string;
  match_in: string[];
  total_count: number;
}

export interface CourierSearchPage {
  results: CourierSearchResult[];
  totalCount: number;
}

export async function searchCouriers(params: CourierSearchParams): Promise<CourierSearchPage> {
  const limit = params.limit ?? 20;
  const offset = params.offset ?? 0;

  const { rows, totalCount } = await fetchCourierListPage(
    {
      organizationId: params.organizationId,
      direction: params.direction ?? null,
      workflowStateIds: params.workflowStateId ? [params.workflowStateId] : null,
      socleOrganizationId: params.socleOrganizationId ?? null,
      visibleSocleOrganizationIds: params.visibleSocleOrganizationIds,
      keywords: params.keywords ?? null,
      // La page Recherche garde la syntaxe websearch (guillemets, OR, -), là où
      // les listes veulent la recherche par préfixe au fil de la frappe.
      prefixMatch: false,
      tagNames: params.tagNames ?? null,
      dateFrom: params.dateFrom ?? null,
      dateTo: params.dateTo ?? null,
      sortBy: "received_at",
    },
    // `fetchCourierListPage` raisonne en pages ; cette API expose un offset brut.
    Math.floor(offset / limit),
    limit,
  );

  return { results: rows as unknown as CourierSearchResult[], totalCount };
}
