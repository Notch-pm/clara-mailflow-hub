import { supabase } from "@/integrations/supabase/client";
import type { CourierLink } from "@/types/courier";

export async function getLinks(courierId: string) {
  return supabase
    .from("courier_links")
    .select("*")
    .eq("courier_id", courierId)
    .order("created_at");
}

export async function addLink(data: Omit<CourierLink, "id" | "created_at">) {
  return supabase
    .from("courier_links")
    .insert(data)
    .select()
    .single();
}

export async function removeLink(linkId: string) {
  return supabase
    .from("courier_links")
    .delete()
    .eq("id", linkId);
}
