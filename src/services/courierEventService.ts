import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

/** Charge utile d'un événement (`courier_events.payload`). */
export type EventPayload = { [key: string]: Json | undefined };

/**
 * Fire-and-forget event logger used by UI mutations.
 * Never throws — failures only log to the console so the main action is not blocked.
 */
export async function logEvent(
  organizationId: string,
  courierId: string,
  eventType: string,
  payload?: EventPayload,
): Promise<void> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    await supabase.from("courier_events").insert({
      organization_id: organizationId,
      courier_id: courierId,
      event_type: eventType,
      payload: payload ?? null,
      created_by: user?.id ?? null,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[logEvent:${eventType}] failed`, err);
  }
}
