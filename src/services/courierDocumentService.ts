import { supabase } from "@/integrations/supabase/client";

export async function getDocuments(courierId: string) {
  const { data, error } = await supabase
    .from("courier_documents")
    .select("*")
    .eq("courier_id", courierId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
}
