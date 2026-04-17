import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import JSZip from "https://esm.sh/jszip@3.10.1";
import { extractText, getDocumentProxy } from "https://esm.sh/unpdf@0.12.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-org-id",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const BUCKET = "clara-documents";
const MISTRAL_OCR_URL = "https://api.mistral.ai/v1/ocr";
const MISTRAL_CHAT_URL = "https://api.mistral.ai/v1/chat/completions";
const OCR_MODEL = "mistral-ocr-latest";
const CHAT_MODEL = "mistral-large-latest";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getAdminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function verifyAuth(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) throw new Error("Unauthorized");
  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const anonClient = createClient(url, anonKey, { auth: { persistSession: false } });
  const token = authHeader.replace("Bearer ", "");
  const { data, error } = await anonClient.auth.getUser(token);
  if (error || !data.user) throw new Error("Unauthorized");
  return data.user;
}

async function verifyOrgMembership(
  admin: ReturnType<typeof getAdminClient>,
  userId: string,
  orgId: string,
) {
  const { data: userRow } = await admin
    .from("users")
    .select("is_superadmin")
    .eq("id", userId)
    .single();
  if (userRow?.is_superadmin) return;

  const { data, error } = await admin
    .from("organization_users")
    .select("id")
    .eq("user_id", userId)
    .eq("organization_id", orgId)
    .eq("is_active", true)
    .limit(1)
    .single();
  if (error || !data) throw new Error("Forbidden: user does not belong to this organization");
}

/** Run OCR via Mistral on a single document, store extract, return text. */
async function ocrDocument(
  admin: ReturnType<typeof getAdminClient>,
  orgId: string,
  documentId: string,
  mistralKey: string,
) {
  // Fetch document
  const { data: doc, error: docErr } = await admin
    .from("courier_documents")
    .select("id, courier_id, organization_id, storage_key, file_name, mime_type")
    .eq("id", documentId)
    .single();
  if (docErr || !doc) throw new Error("Document not found");
  if (doc.organization_id !== orgId) throw new Error("Forbidden: document not in org");

  const mime = doc.mime_type ?? "";
  let extractedText = "";
  let pageCount: number | null = null;
  let model = OCR_MODEL;

  if (mime.startsWith("text/")) {
    // Plain text → download directly
    const { data: blob, error: dlErr } = await admin.storage.from(BUCKET).download(doc.storage_key);
    if (dlErr || !blob) throw new Error(`Téléchargement impossible: ${dlErr?.message}`);
    extractedText = await blob.text();
    model = "direct-text";
  } else {
    // Need a public-ish URL for Mistral → signed URL
    const { data: signed, error: signErr } = await admin.storage
      .from(BUCKET)
      .createSignedUrl(doc.storage_key, 600);
    if (signErr || !signed) throw new Error(`Signed URL error: ${signErr?.message}`);

    const isImage = mime.startsWith("image/");
    const ocrBody = isImage
      ? {
          model: OCR_MODEL,
          document: { type: "image_url", image_url: signed.signedUrl },
          include_image_base64: false,
        }
      : {
          model: OCR_MODEL,
          document: { type: "document_url", document_url: signed.signedUrl },
          include_image_base64: false,
        };

    const ocrResp = await fetch(MISTRAL_OCR_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${mistralKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(ocrBody),
    });

    if (!ocrResp.ok) {
      const t = await ocrResp.text();
      console.error("Mistral OCR error", ocrResp.status, t);
      throw new Error(`Mistral OCR ${ocrResp.status}: ${t.slice(0, 200)}`);
    }
    const ocrData = await ocrResp.json();
    // Response shape: { pages: [{ index, markdown, ... }], ... }
    const pages = Array.isArray(ocrData.pages) ? ocrData.pages : [];
    pageCount = pages.length || null;
    extractedText = pages
      .map((p: { markdown?: string; text?: string }) => p.markdown ?? p.text ?? "")
      .join("\n\n---\n\n")
      .trim();
  }

  // Upsert into extracts (unique on document_id)
  const { data: row, error: upErr } = await admin
    .from("courier_document_extracts")
    .upsert(
      {
        document_id: doc.id,
        courier_id: doc.courier_id,
        organization_id: orgId,
        text: extractedText,
        page_count: pageCount,
        model,
      },
      { onConflict: "document_id" },
    )
    .select()
    .single();
  if (upErr) throw new Error(`DB upsert: ${upErr.message}`);
  return row;
}

/** Run analysis using all extracts of a courier. */
async function analyzeCourier(
  admin: ReturnType<typeof getAdminClient>,
  orgId: string,
  courierId: string,
  mistralKey: string,
) {
  // Get courier subject + extracts
  const { data: courier } = await admin
    .from("couriers")
    .select("id, subject, organization_id")
    .eq("id", courierId)
    .single();
  if (!courier || courier.organization_id !== orgId) throw new Error("Courier not found");

  const { data: extracts } = await admin
    .from("courier_document_extracts")
    .select("text, document_id")
    .eq("courier_id", courierId)
    .eq("organization_id", orgId);

  const concatenated = (extracts ?? [])
    .map((e) => e.text)
    .filter(Boolean)
    .join("\n\n===\n\n")
    .slice(0, 60_000); // safety cap

  if (!concatenated.trim()) {
    throw new Error("Aucun texte extrait à analyser. Lancez d'abord l'extraction OCR.");
  }

  const systemPrompt = `Tu es un assistant expert en gestion de courrier administratif. Analyse le contenu fourni et restitue UNIQUEMENT via l'outil "report_analysis" :
- summary: résumé concis (2-3 phrases) du contenu
- intents: liste des intentions/objets principaux (verbe + complément court, ex: "demande d'attestation", "réclamation facture")
- sentiment: ton/état d'esprit du rédacteur, parmi: neutre, courtois, urgent, mécontent, agressif, satisfait, inquiet
- suggested_actions: 2 à 5 actions concrètes que l'organisation devrait entreprendre
Sois factuel, en français.`;

  const userPrompt = `Sujet du courrier : ${courier.subject ?? "(aucun)"}\n\nContenu extrait des pièces jointes :\n${concatenated}`;

  const tools = [
    {
      type: "function",
      function: {
        name: "report_analysis",
        description: "Retourne l'analyse structurée du courrier",
        parameters: {
          type: "object",
          properties: {
            summary: { type: "string" },
            intents: { type: "array", items: { type: "string" } },
            sentiment: {
              type: "string",
              enum: ["neutre", "courtois", "urgent", "mécontent", "agressif", "satisfait", "inquiet"],
            },
            suggested_actions: { type: "array", items: { type: "string" } },
          },
          required: ["summary", "intents", "sentiment", "suggested_actions"],
          additionalProperties: false,
        },
      },
    },
  ];

  const chatResp = await fetch(MISTRAL_CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${mistralKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: CHAT_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      tools,
      tool_choice: { type: "function", function: { name: "report_analysis" } },
      temperature: 0.2,
    }),
  });

  if (!chatResp.ok) {
    const t = await chatResp.text();
    console.error("Mistral chat error", chatResp.status, t);
    throw new Error(`Mistral chat ${chatResp.status}: ${t.slice(0, 200)}`);
  }

  const chatData = await chatResp.json();
  const toolCall = chatData?.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall?.function?.arguments) {
    throw new Error("Réponse Mistral inattendue (pas de tool_call)");
  }
  let parsed: {
    summary: string;
    intents: string[];
    sentiment: string;
    suggested_actions: string[];
  };
  try {
    parsed = JSON.parse(toolCall.function.arguments);
  } catch {
    throw new Error("JSON invalide depuis Mistral");
  }

  const tokensUsed = chatData?.usage?.total_tokens ?? null;

  const { data: row, error: upErr } = await admin
    .from("courier_analyses")
    .upsert(
      {
        courier_id: courierId,
        organization_id: orgId,
        summary: parsed.summary,
        intents: parsed.intents ?? [],
        sentiment: parsed.sentiment,
        suggested_actions: parsed.suggested_actions ?? [],
        model: CHAT_MODEL,
        tokens_used: tokensUsed,
      },
      { onConflict: "courier_id" },
    )
    .select()
    .single();
  if (upErr) throw new Error(`DB upsert: ${upErr.message}`);
  return row;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const user = await verifyAuth(req);
    const admin = getAdminClient();
    const orgId = req.headers.get("x-org-id");
    if (!orgId) return jsonResponse({ error: "Missing x-org-id header" }, 400);

    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRe.test(orgId)) return jsonResponse({ error: "Invalid x-org-id" }, 400);

    await verifyOrgMembership(admin, user.id, orgId);

    const mistralKey = Deno.env.get("MISTRAL_API_KEY");
    if (!mistralKey) return jsonResponse({ error: "MISTRAL_API_KEY non configurée" }, 500);

    const url = new URL(req.url);
    const action = url.searchParams.get("action");

    if (req.method === "POST" && action === "ocr-courier") {
      const { courier_id } = await req.json();
      if (!courier_id) return jsonResponse({ error: "Missing courier_id" }, 400);

      // Fetch all docs of the courier
      const { data: docs, error: dErr } = await admin
        .from("courier_documents")
        .select("id, mime_type")
        .eq("courier_id", courier_id)
        .eq("organization_id", orgId);
      if (dErr) return jsonResponse({ error: dErr.message }, 500);
      if (!docs || docs.length === 0) {
        return jsonResponse({ error: "Aucun document à extraire" }, 400);
      }

      const results: Array<{ document_id: string; ok: boolean; error?: string }> = [];
      for (const d of docs) {
        try {
          await ocrDocument(admin, orgId, d.id, mistralKey);
          results.push({ document_id: d.id, ok: true });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "unknown";
          console.error(`OCR doc ${d.id} failed:`, msg);
          results.push({ document_id: d.id, ok: false, error: msg });
        }
      }
      return jsonResponse({ results });
    }

    if (req.method === "POST" && action === "analyze") {
      const { courier_id } = await req.json();
      if (!courier_id) return jsonResponse({ error: "Missing courier_id" }, 400);
      const row = await analyzeCourier(admin, orgId, courier_id, mistralKey);
      return jsonResponse(row);
    }

    return jsonResponse({ error: "Unknown action" }, 400);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    const status =
      message === "Unauthorized" ? 401 : message.startsWith("Forbidden") ? 403 : 500;
    return jsonResponse({ error: message }, status);
  }
});
