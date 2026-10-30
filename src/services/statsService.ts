import { supabase } from "@/integrations/supabase/client";
import type { SlaFactRow } from "@/lib/stats-sla";

export interface StatMonthPoint { month: string; count: number }
export interface StatDayPoint { day: string; count: number }
export interface StatTagPoint {
  period: string;
  tag_name: string;
  /**
   * Groupe du tag, résolu côté SQL par jointure sur le nom. Un tag appliqué
   * puis retiré du référentiel n'en a plus : il compte en `theme`.
   */
  tag_group: "theme" | "sentiment";
  count: number;
}
export interface StatChannelPoint { channel: string; count: number }
export interface StatServicePoint { socle_organization_id: string | null; service_name: string; count: number }
export interface StatProcessingPoint {
  service_name: string;
  avg_days_to_instruction: number | null;
  avg_days_to_processed: number | null;
  courier_count: number;
}
async function rpc<T>(fn: string, params: Record<string, unknown>): Promise<T[]> {
  const { data, error } = await (supabase.rpc as unknown as (
    fn: string,
    params: Record<string, unknown>
  ) => Promise<{ data: T[] | null; error: unknown }>)(fn, params);
  if (error) throw error;
  return data ?? [];
}

export async function getInboundByMonth(
  orgId: string,
  months = 12,
  socleOrganizationId?: string,
): Promise<StatMonthPoint[]> {
  return rpc<StatMonthPoint>("stats_inbound_by_month", {
    p_org_id: orgId,
    p_months: months,
    p_socle_organization_id: socleOrganizationId ?? null,
  });
}

export async function getInboundByDay(
  orgId: string,
  socleOrganizationId?: string,
): Promise<StatDayPoint[]> {
  return rpc<StatDayPoint>("stats_inbound_by_day", {
    p_org_id: orgId,
    p_socle_organization_id: socleOrganizationId ?? null,
  });
}

export async function getTagEvolution(
  orgId: string,
  since: Date,
  socleOrganizationId?: string,
): Promise<StatTagPoint[]> {
  return rpc<StatTagPoint>("stats_tag_evolution", {
    p_org_id: orgId,
    p_since: since.toISOString(),
    p_socle_organization_id: socleOrganizationId ?? null,
  });
}

export async function getByChannel(
  orgId: string,
  since: Date,
  socleOrganizationId?: string,
): Promise<StatChannelPoint[]> {
  return rpc<StatChannelPoint>("stats_by_channel", {
    p_org_id: orgId,
    p_since: since.toISOString(),
    p_socle_organization_id: socleOrganizationId ?? null,
  });
}

export async function getByService(
  orgId: string,
  direction: "inbound" | "outbound",
  since: Date,
): Promise<StatServicePoint[]> {
  return rpc<StatServicePoint>("stats_by_service", {
    p_org_id: orgId,
    p_direction: direction,
    p_since: since.toISOString(),
  });
}

export async function getRepliesByMonth(
  orgId: string,
  months = 12,
  socleOrganizationId?: string,
): Promise<StatMonthPoint[]> {
  return rpc<StatMonthPoint>("stats_replies_by_month", {
    p_org_id: orgId,
    p_months: months,
    p_socle_organization_id: socleOrganizationId ?? null,
  });
}

export async function getProcessingTimes(
  orgId: string,
  since: Date,
): Promise<StatProcessingPoint[]> {
  return rpc<StatProcessingPoint>("stats_processing_times", {
    p_org_id: orgId,
    p_since: since.toISOString(),
  });
}


const SLA_FACTS_PAGE_SIZE = 1000;

/**
 * Faits de délai des courriers reçus depuis `since` (date de réception, à
 * défaut de création) : de quoi juger chaque échéance côté client avec
 * `courierSla`. Lu sous RLS — un confidentiel non lisible ne compte pas, comme
 * dans les autres graphiques.
 */
export async function getSlaFacts(
  orgId: string,
  since: Date,
  socleOrganizationId?: string,
): Promise<SlaFactRow[]> {
  const sinceISO = since.toISOString();
  const rows: SlaFactRow[] = [];
  for (let offset = 0; ; offset += SLA_FACTS_PAGE_SIZE) {
    let query = supabase
      .from("couriers")
      .select("id, received_at, created_at, acknowledged_at, resolved_at, socle_organization_id")
      .eq("organization_id", orgId)
      .eq("direction", "inbound")
      .is("deleted_at", null)
      .or(`received_at.gte."${sinceISO}",and(received_at.is.null,created_at.gte."${sinceISO}")`)
      .order("id")
      .range(offset, offset + SLA_FACTS_PAGE_SIZE - 1);
    if (socleOrganizationId) query = query.eq("socle_organization_id", socleOrganizationId);
    const { data, error } = await query;
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page);
    if (page.length < SLA_FACTS_PAGE_SIZE) return rows;
  }
}
