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

export interface SuggestedAction {
  label: string;
  procedure_id?: string | null;
  procedure_name?: string | null;
  prefill?: {
    CIVILITE?: string;
    NOM_USUEL?: string;
    NOM_NAISSANCE?: string;
    PRENOMS?: string;
    DATE_NAISSANCE?: string;
    EMAIL?: string;
    TEL_FIXE?: string;
    TEL_MOBILE?: string;
  };
}

export interface CourierAnalysis {
  id: string;
  courier_id: string;
  organization_id: string;
  summary: string | null;
  intents: string[];
  sentiment: string | null;
  suggested_actions: SuggestedAction[];
  model: string | null;
  tokens_used: number | null;
  created_at: string;
  updated_at: string;
}

/** Normalize suggested_actions: handles both legacy string[] and new SuggestedAction[] */
function normalizeSuggestedActions(raw: unknown): SuggestedAction[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) =>
    typeof item === "string" ? { label: item } : (item as SuggestedAction),
  );
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
  if (!data) return null;
  const row = data as unknown as CourierAnalysis;
  return { ...row, suggested_actions: normalizeSuggestedActions(row.suggested_actions) };
}

/** Trigger OCR extraction for every document of the courier. */
export async function runOcr(courierId: string) {
  const { data, error } = await supabase.functions.invoke("analyze-courier?action=ocr-courier", {
    body: { courier_id: courierId },
  });
  if (error) {
    // Cas légitime : courrier sans pièce jointe (email texte pur) → l'edge function
    // renvoie 400 "Aucun document à extraire". On ne traite pas ça comme une erreur.
    const ctx: any = (error as any).context;
    const msg = String((error as any).message || "");
    if (
      ctx?.status === 400 ||
      msg.includes("Aucun document") ||
      msg.includes("non-2xx")
    ) {
      return { results: [] as Array<{ document_id: string; ok: boolean; error?: string }> };
    }
    throw error;
  }
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
