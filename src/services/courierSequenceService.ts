import { supabase } from "@/integrations/supabase/client";
import type { CourierDirection } from "@/types/courier";

export async function getNextReference(organizationId: string, direction: CourierDirection) {
  return supabase
    .from("courier_sequences")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("direction", direction)
    .eq("year", new Date().getFullYear())
    .single();
}
