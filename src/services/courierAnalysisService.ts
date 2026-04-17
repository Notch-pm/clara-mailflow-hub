import { supabase } from "@/integrations/supabase/client";

export interface CourierDocumentExtract {
  id: string;
  document_id: string;
  courier_id: string;
  organization_id: string;
  text: string;
  page_count: number | null;
  model: string | null;
  tokens_used: number | null;
  created_at: string;
  updated_at: string;
}

export interface CourierAnalysis {
  id: string;
  courier_id: string;
  organization_id: string;
  summary: string | null;
  intents: string[];
  sentiment: string | null;
  suggested_actions: string[];
  model: string | null;
  tokens_used: number | null;
  created_at: string;
  updated_at: string;
}

/** Read cached extracts for the courier's documents. */
export async function getExtracts(courierId: string): Promise<CourierDocumentExtract[]> {
  const { data, error } = await supabase
    .from("courier_document_extracts" as never)
    .select("*")
    .eq("courier_id", courierId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data as unknown as CourierDocumentExtract[]) ?? [];
}

/** Read cached analysis for a courier (or null). */
export async function getAnalysis(courierId: string): Promise<CourierAnalysis | null> {
  const { data, error } = await supabase
    .from("courier_analyses" as never)
    .select("*")
    .eq("courier_id", courierId)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as CourierAnalysis) ?? null;
}

/** Trigger OCR extraction for every document of the courier. */
export async function runOcr(courierId: string) {
  const { data, error } = await supabase.functions.invoke("analyze-courier?action=ocr-courier", {
    body: { courier_id: courierId },
  });
  if (error) throw error;
  return data as { results: Array<{ document_id: string; ok: boolean; error?: string }> };
}

/** Trigger LLM analysis based on cached extracts. */
export async function runAnalysis(courierId: string) {
  const { data, error } = await supabase.functions.invoke("analyze-courier?action=analyze", {
    body: { courier_id: courierId },
  });
  if (error) throw error;
  return data as CourierAnalysis;
}
