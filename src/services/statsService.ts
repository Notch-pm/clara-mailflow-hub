import { supabase } from "@/integrations/supabase/client";

export interface StatMonthPoint { month: string; count: number }
export interface StatDayPoint { day: string; count: number }
export interface StatTagPoint { period: string; tag_name: string; count: number }
export interface StatChannelPoint { channel: string; count: number }
export interface StatServicePoint { service_name: string; count: number }
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
  serviceName?: string,
): Promise<StatMonthPoint[]> {
  return rpc<StatMonthPoint>("stats_inbound_by_month", {
    p_org_id: orgId,
    p_months: months,
    p_service_name: serviceName ?? null,
  });
}

export async function getInboundByDay(
  orgId: string,
  serviceName?: string,
): Promise<StatDayPoint[]> {
  return rpc<StatDayPoint>("stats_inbound_by_day", {
    p_org_id: orgId,
    p_service_name: serviceName ?? null,
  });
}

export async function getTagEvolution(
  orgId: string,
  since: Date,
  serviceName?: string,
): Promise<StatTagPoint[]> {
  return rpc<StatTagPoint>("stats_tag_evolution", {
    p_org_id: orgId,
    p_since: since.toISOString(),
    p_service_name: serviceName ?? null,
  });
}

export async function getByChannel(
  orgId: string,
  since: Date,
  serviceName?: string,
): Promise<StatChannelPoint[]> {
  return rpc<StatChannelPoint>("stats_by_channel", {
    p_org_id: orgId,
    p_since: since.toISOString(),
    p_service_name: serviceName ?? null,
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
  serviceName?: string,
): Promise<StatMonthPoint[]> {
  return rpc<StatMonthPoint>("stats_replies_by_month", {
    p_org_id: orgId,
    p_months: months,
    p_service_name: serviceName ?? null,
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
