import { supabase } from "@/integrations/supabase/client";
import type { CourierEventInsert } from "@/types/courier";

export async function getEvents(courierId: string) {
  return supabase
    .from("courier_events")
    .select("*")
    .eq("courier_id", courierId)
    .order("created_at", { ascending: false });
}

export async function addEvent(data: CourierEventInsert) {
  return supabase
    .from("courier_events")
    .insert(data)
    .select()
    .single();
}

/**
 * Fire-and-forget event logger used by UI mutations.
 * Never throws — failures only log to the console so the main action is not blocked.
 */
export async function logEvent(
  organizationId: string,
  courierId: string,
  eventType: string,
  payload?: Record<string, unknown>,
): Promise<void> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    await supabase.from("courier_events").insert({
      organization_id: organizationId,
      courier_id: courierId,
      event_type: eventType,
      payload: (payload ?? null) as never,
      created_by: user?.id ?? null,
    } as never);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[logEvent:${eventType}] failed`, err);
  }
}
