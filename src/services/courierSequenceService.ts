import { supabase } from "@/integrations/supabase/client";
import type { CourierType } from "@/types/courier";

export async function getNextReference(organizationId: string, courierType: CourierType) {
  return supabase
    .from("courier_sequences")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("courier_type", courierType)
    .eq("year", new Date().getFullYear())
    .single();
}
