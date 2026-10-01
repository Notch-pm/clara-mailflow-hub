import { supabase } from "@/integrations/supabase/client";
import type { SocleContact } from "@/services/socleContactService";
import { edgeError } from "@/lib/edge-error";
import type {
  SenderCivility,
  SenderMatch,
} from "../../supabase/functions/_shared/senderMatchLogic";

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
  /**
   * Organisation destinataire suggérée (id du miroir `socle_organizations`),
   * choisie parmi celles qui assurent réellement la démarche — revalidée côté
   * serveur, jamais reprise telle quelle du modèle.
   */
  socle_organization_id?: string | null;
  socle_organization_name?: string | null;
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
  /** Préremplissage d'une démarche Socle (audience + valeurs par clé de champ
   *  du form_schema), produit par l'appel ciblé d'analyze-courier. */
  socle_prefill?: {
    audience?: string | null;
    form?: Record<string, unknown> | null;
  } | null;
}

export interface SuggestedSender {
  /** Civilité lue dans le courrier — absente des analyses antérieures. */
  civility?: SenderCivility | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
}

export interface CourierAnalysis {
  id: string;
  courier_id: string;
  organization_id: string;
  summary: string | null;
  intents: string[];
  sentiment: string | null;
  suggested_actions: SuggestedAction[];
  suggested_subject: string | null;
  suggested_service_name: string | null;
  /** Organisation gestionnaire proposée (revalidée contre le catalogue) — une proposition. */
  suggested_socle_organization_id: string | null;
  /** Pourquoi cette organisation, en une phrase. */
  suggested_service_reason: string | null;
  suggested_recipient_name: string | null;
  suggested_sender: SuggestedSender | null;
  model: string | null;
  tokens_used: number | null;
  created_at: string;
  updated_at: string;
}

export interface FilePayload {
  name: string;
  mime_type: string;
  content_base64: string;
}

export interface ExtractCourierInfoResult {
  suggested_subject: string | null;
  sender: SuggestedSender;
  recipient_name: string | null;
  suggested_service_name: string | null;
  suggested_tag_names: string[];
  /** Contact Socle sélectionné d'office (= `sender_match.contact` quand `status === "matched"`). */
  matched_contact: SocleContact | null;
  /**
   * Résultat du rapprochement de l'expéditeur (règle de `senderMatchLogic`) :
   * sélectionné, proposé ou absent, avec les divergences à signaler. `null`
   * si le référentiel n'a pas répondu (à refaire côté écran, surtout ne pas
   * conclure à un inconnu) ; absent d'une edge function antérieure au 2026-09-23.
   */
  sender_match?: SenderMatch<SocleContact> | null;
  extracted_text: string | null;
  quota_exceeded?: boolean;
  /** Pièces du lot restées illisibles, avec leur motif — l'extraction a abouti
   *  sur les autres. */
  ocr_failures?: string[];
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
    const err = await edgeError(error, "Extraction OCR impossible");
    // Cas légitime : courrier sans pièce jointe (email texte pur) → l'edge
    // function renvoie 400 « Aucun document à extraire ». Le test portait aussi
    // sur « non-2xx », c'est-à-dire sur TOUTES les erreurs : le plafond IA
    // atteint comme une panne du guichet passaient pour une absence de pièce
    // jointe, et l'écran n'affichait rien du tout.
    if (err.status === 400) {
      return { results: [] as Array<{ document_id: string; ok: boolean; error?: string }> };
    }
    throw err;
  }
  return data as { results: Array<{ document_id: string; ok: boolean; error?: string }> };
}

/** Trigger LLM analysis based on cached extracts. */
export async function runAnalysis(courierId: string) {
  const { data, error } = await supabase.functions.invoke("analyze-courier?action=analyze", {
    body: { courier_id: courierId },
  });
  if (error) throw await edgeError(error, "Analyse impossible");
  return data as CourierAnalysis;
}

/** OCR (if needed) then analysis, in one call — used for the first-time "Analyser" action. */
export async function runFullAnalysis(courierId: string) {
  await runOcr(courierId);
  return runAnalysis(courierId);
}

/** Base64-encode files for the `extract-courier-info` edge function. */
export async function encodeFilesToBase64(files: File[]): Promise<FilePayload[]> {
  return Promise.all(
    files.map(async (file) => {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      return {
        name: file.name,
        mime_type: file.type || "application/octet-stream",
        content_base64: btoa(binary),
      };
    }),
  );
}

/** Pre-creation OCR + extraction: from file(s) and/or pasted text, suggest title,
 *  sender, recipient, service and tags. Used by `NewCourierDialog` and `BulkImport`. */
export async function extractCourierInfo(args: {
  files?: File[];
  pastedText?: string;
}): Promise<ExtractCourierInfoResult> {
  const filePayloads = args.files?.length
    ? await encodeFilesToBase64(args.files.slice(0, 5))
    : undefined;
  const pastedText = args.pastedText?.trim();

  const { data, error } = await supabase.functions.invoke("extract-courier-info", {
    body: {
      ...(filePayloads ? { files: filePayloads } : {}),
      ...(pastedText ? { pasted_text: pastedText } : {}),
    },
  });
  if (error) throw await edgeError(error, "Analyse impossible");
  if (data?.error) throw new Error(data.error);
  return data as ExtractCourierInfoResult;
}
