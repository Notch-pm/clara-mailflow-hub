import { supabase } from "@/integrations/supabase/client";
import type { CourierDocumentInsert } from "@/types/courier";

export async function getDocuments(courierId: string) {
  const { data, error } = await supabase
    .from("courier_documents")
    .select("*")
    .eq("courier_id", courierId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export async function addDocument(data: CourierDocumentInsert) {
  const { data: result, error } = await supabase
    .from("courier_documents")
    .insert(data)
    .select()
    .single();

  if (error) throw error;
  return result;
}

export async function removeDocument(documentId: string) {
  const { error } = await supabase
    .from("courier_documents")
    .delete()
    .eq("id", documentId);

  if (error) throw error;
}
