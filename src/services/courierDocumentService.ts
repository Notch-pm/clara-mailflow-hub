import { supabase } from "@/integrations/supabase/client";
import type { CourierDocument } from "@/types/courier";

export async function getDocuments(courierId: string) {
  return supabase
    .from("courier_documents")
    .select("*")
    .eq("courier_id", courierId)
    .order("created_at");
}

export async function addDocument(data: Omit<CourierDocument, "id" | "created_at">) {
  return supabase
    .from("courier_documents")
    .insert(data)
    .select()
    .single();
}

export async function removeDocument(documentId: string) {
  return supabase
    .from("courier_documents")
    .delete()
    .eq("id", documentId);
}
