import { supabase } from "@/integrations/supabase/client";

export interface CourierSearchParams {
  organizationId: string;
  direction?: "inbound" | "outbound" | null;
  workflowStateId?: string | null;
  service?: string | null;
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
  organization_id: string;
  match_in: string[];
  total_count: number;
}

export interface CourierSearchPage {
  results: CourierSearchResult[];
  totalCount: number;
}

export async function searchCouriers(params: CourierSearchParams): Promise<CourierSearchPage> {
  const { data, error } = await (supabase as any).rpc("search_couriers", {
    p_organization_id:    params.organizationId,
    p_direction:          params.direction ?? null,
    p_workflow_state_id:  params.workflowStateId ?? null,
    p_service:            params.service ?? null,
    p_keywords:           params.keywords?.trim() || null,
    p_tag_names:          params.tagNames?.length ? params.tagNames : null,
    p_date_from:          params.dateFrom ?? null,
    p_date_to:            params.dateTo ?? null,
    p_limit:              params.limit ?? 20,
    p_offset:             params.offset ?? 0,
  });
  if (error) throw error;
  const rows = (data ?? []) as CourierSearchResult[];
  return { results: rows, totalCount: rows[0]?.total_count ?? 0 };
}
