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
const MISTRAL_AGENT_URL = "https://api.mistral.ai/v1/agents/completions";
const OCR_MODEL = "mistral-ocr-latest";
const CHAT_MODEL = "mistral-large-latest";
const ANALYSIS_AGENT_ID = "ag_019d9b92d28872079534f45f246671ed";

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

/** Strip XML tags and decode common entities to plain text. */
function xmlToText(xml: string): string {
  return xml
    // Convert paragraph/break boundaries to newlines
    .replace(/<\/w:p>/g, "\n")
    .replace(/<w:br\s*\/?>/g, "\n")
    .replace(/<\/text:p>/g, "\n")
    .replace(/<text:line-break\s*\/?>/g, "\n")
    .replace(/<text:tab\s*\/?>/g, "\t")
    // Strip all remaining tags
    .replace(/<[^>]+>/g, "")
    // Decode common XML entities
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    // Collapse runs of blank lines
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function extractDocx(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const zip = await JSZip.loadAsync(buf);
  const file = zip.file("word/document.xml");
  if (!file) throw new Error("DOCX invalide: word/document.xml introuvable");
  const xml = await file.async("string");
  return xmlToText(xml);
}

async function extractOdt(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const zip = await JSZip.loadAsync(buf);
  const file = zip.file("content.xml");
  if (!file) throw new Error("ODT invalide: content.xml introuvable");
  const xml = await file.async("string");
  return xmlToText(xml);
}

function extractRtf(rtf: string): string {
  // Very small RTF stripper: handles common control words, hex escapes, groups.
  let out = rtf;
  // Drop font/color tables and stylesheets (everything inside their groups)
  out = out.replace(/\{\\(fonttbl|colortbl|stylesheet|info|\*\\[a-z]+)[^{}]*(\{[^{}]*\}[^{}]*)*\}/gi, "");
  // Hex-escaped chars: \'xx
  out = out.replace(/\\'([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  // Unicode escapes: \uXXXX?
  out = out.replace(/\\u(-?\d+)\??/g, (_, n) => String.fromCodePoint(((parseInt(n, 10) + 65536) % 65536)));
  // Paragraph / line breaks
  out = out.replace(/\\par[d]?\b/g, "\n").replace(/\\line\b/g, "\n").replace(/\\tab\b/g, "\t");
  // Remaining control words (\word, \word123)
  out = out.replace(/\\[a-zA-Z]+-?\d* ?/g, "");
  // Escaped braces and backslashes
  out = out.replace(/\\([{}\\])/g, "$1");
  // Drop remaining group braces
  out = out.replace(/[{}]/g, "");
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

async function extractPdfNative(blob: Blob): Promise<{ text: string; pageCount: number }> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  const pdf = await getDocumentProxy(buf);
  const { text } = await extractText(pdf, { mergePages: true });
  return {
    text: (Array.isArray(text) ? text.join("\n\n") : text).trim(),
    pageCount: pdf.numPages,
  };
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

  const mime = (doc.mime_type ?? "").toLowerCase();
  const fileName = (doc.file_name ?? "").toLowerCase();
  let extractedText = "";
  let pageCount: number | null = null;
  let model = OCR_MODEL;

  const isDocx =
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    fileName.endsWith(".docx");
  const isOdt = mime === "application/vnd.oasis.opendocument.text" || fileName.endsWith(".odt");
  const isRtf =
    mime === "application/rtf" || mime === "text/rtf" || fileName.endsWith(".rtf");
  const isPdf = mime === "application/pdf" || fileName.endsWith(".pdf");
  const isText = mime.startsWith("text/");
  const isImage = mime.startsWith("image/");

  // ---- Native paths (no Mistral OCR) ----
  if (isText) {
    const { data: blob, error: dlErr } = await admin.storage.from(BUCKET).download(doc.storage_key);
    if (dlErr || !blob) throw new Error(`Téléchargement impossible: ${dlErr?.message}`);
    extractedText = await blob.text();
    model = "direct-text";
  } else if (isDocx) {
    const { data: blob, error: dlErr } = await admin.storage.from(BUCKET).download(doc.storage_key);
    if (dlErr || !blob) throw new Error(`Téléchargement impossible: ${dlErr?.message}`);
    extractedText = await extractDocx(blob);
    model = "native-docx";
  } else if (isOdt) {
    const { data: blob, error: dlErr } = await admin.storage.from(BUCKET).download(doc.storage_key);
    if (dlErr || !blob) throw new Error(`Téléchargement impossible: ${dlErr?.message}`);
    extractedText = await extractOdt(blob);
    model = "native-odt";
  } else if (isRtf) {
    const { data: blob, error: dlErr } = await admin.storage.from(BUCKET).download(doc.storage_key);
    if (dlErr || !blob) throw new Error(`Téléchargement impossible: ${dlErr?.message}`);
    extractedText = extractRtf(await blob.text());
    model = "native-rtf";
  } else if (isPdf) {
    // Try native text extraction first
    const { data: blob, error: dlErr } = await admin.storage.from(BUCKET).download(doc.storage_key);
    if (dlErr || !blob) throw new Error(`Téléchargement impossible: ${dlErr?.message}`);
    let nativeFailed = false;
    try {
      const native = await extractPdfNative(blob);
      // Heuristic: if very little text relative to page count, treat as scanned PDF
      const minChars = Math.max(50, native.pageCount * 30);
      if (native.text.length >= minChars) {
        extractedText = native.text;
        pageCount = native.pageCount;
        model = "native-pdf";
      } else {
        nativeFailed = true;
        pageCount = native.pageCount;
      }
    } catch (e) {
      console.warn("Native PDF extraction failed, falling back to OCR:", (e as Error).message);
      nativeFailed = true;
    }

    if (nativeFailed) {
      // Fallback: Mistral OCR via signed URL
      const { data: signed, error: signErr } = await admin.storage
        .from(BUCKET)
        .createSignedUrl(doc.storage_key, 600);
      if (signErr || !signed) throw new Error(`Signed URL error: ${signErr?.message}`);

      const ocrResp = await fetch(MISTRAL_OCR_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${mistralKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: OCR_MODEL,
          document: { type: "document_url", document_url: signed.signedUrl },
          include_image_base64: false,
        }),
      });
      if (!ocrResp.ok) {
        const t = await ocrResp.text();
        console.error("Mistral OCR error", ocrResp.status, t);
        throw new Error(`Mistral OCR ${ocrResp.status}: ${t.slice(0, 200)}`);
      }
      const ocrData = await ocrResp.json();
      const pages = Array.isArray(ocrData.pages) ? ocrData.pages : [];
      pageCount = pages.length || pageCount;
      extractedText = pages
        .map((p: { markdown?: string; text?: string }) => p.markdown ?? p.text ?? "")
        .join("\n\n---\n\n")
        .trim();
      model = OCR_MODEL;
    }
  } else {
    // Default: images and unknown formats → Mistral OCR via signed URL
    const { data: signed, error: signErr } = await admin.storage
      .from(BUCKET)
      .createSignedUrl(doc.storage_key, 600);
    if (signErr || !signed) throw new Error(`Signed URL error: ${signErr?.message}`);

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
    .select("id, subject, organization_id, channel, metadata")
    .eq("id", courierId)
    .single();
  if (!courier || courier.organization_id !== orgId) throw new Error("Courier not found");

  const { data: extracts } = await admin
    .from("courier_document_extracts")
    .select("text, document_id")
    .eq("courier_id", courierId)
    .eq("organization_id", orgId);

  // Tags disponibles dans l'organisation — le LLM ne peut choisir QUE parmi ceux-ci
  const { data: orgTags } = await admin
    .from("courier_tags")
    .select("name")
    .eq("organization_id", orgId);
  const availableTagNames = (orgTags ?? [])
    .map((t: { name: string }) => t.name)
    .filter((n) => typeof n === "string" && n.trim().length > 0);

  // Corps de l'email (si présent dans metadata)
  const meta = (courier.metadata ?? {}) as Record<string, unknown>;
  const bodyText = typeof meta.body_text === "string" ? meta.body_text.trim() : "";
  const bodyHtml = typeof meta.body_html === "string" ? meta.body_html : "";
  const bodyFromHtml = bodyHtml
    ? bodyHtml
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
    : "";
  const emailBody = (bodyText || bodyFromHtml).slice(0, 30_000);

  const concatenated = (extracts ?? [])
    .map((e) => e.text)
    .filter(Boolean)
    .join("\n\n===\n\n")
    .slice(0, 60_000); // safety cap

  if (!concatenated.trim() && !emailBody.trim()) {
    throw new Error("Aucun contenu à analyser. Lancez d'abord l'extraction OCR ou ajoutez un corps d'email.");
  }

  const tagListForPrompt = availableTagNames.length > 0
    ? availableTagNames.map((n) => `- ${n}`).join("\n")
    : "(aucun tag défini — laisse intents vide)";

  const systemPrompt = `Tu es un assistant expert en gestion de courrier administratif. Analyse le contenu fourni et restitue UNIQUEMENT via l'outil "report_analysis" :
- summary: résumé concis (2-3 phrases) du contenu
- intents: liste des tags qui qualifient ce courrier, choisis EXCLUSIVEMENT dans la liste des tags disponibles ci-dessous (copie exacte du nom, sensible à la casse). N'invente AUCUN tag. Si aucun tag ne s'applique, renvoie une liste vide.
- sentiment: ton/état d'esprit du rédacteur, parmi: neutre, courtois, urgent, mécontent, agressif, satisfait, inquiet
- suggested_actions: 2 à 5 actions concrètes que l'organisation devrait entreprendre
Sois factuel, en français. Si le corps de l'email et les pièces jointes coexistent, traite-les comme un tout cohérent.

Tags disponibles pour intents :
${tagListForPrompt}`;

  const sections: string[] = [`Sujet du courrier : ${courier.subject ?? "(aucun)"}`];
  if (emailBody.trim()) {
    sections.push(`Corps de l'email :\n${emailBody}`);
  }
  if (concatenated.trim()) {
    sections.push(`Contenu extrait des pièces jointes :\n${concatenated}`);
  }
  const userPrompt = sections.join("\n\n");

  const intentsSchema: Record<string, unknown> = { type: "array", items: { type: "string" } };
  if (availableTagNames.length > 0) {
    intentsSchema.items = { type: "string", enum: availableTagNames };
  }

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
            intents: intentsSchema,
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

  const chatResp = await fetch(MISTRAL_AGENT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${mistralKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      agent_id: ANALYSIS_AGENT_ID,
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
    console.error("Mistral agent error", chatResp.status, t);
    throw new Error(`Mistral agent ${chatResp.status}: ${t.slice(0, 200)}`);
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

  // Sécurité : filtrer les intents pour ne garder que ceux qui appartiennent
  // bien aux tags de l'organisation (mapping strict, insensible à la casse).
  const allowed = new Set(availableTagNames.map((n) => n.toLowerCase()));
  const safeIntents = Array.isArray(parsed.intents)
    ? parsed.intents.filter((i) => typeof i === "string" && allowed.has(i.toLowerCase()))
    : [];

  const { data: row, error: upErr } = await admin
    .from("courier_analyses")
    .upsert(
      {
        courier_id: courierId,
        organization_id: orgId,
        summary: parsed.summary,
        intents: safeIntents,
        sentiment: parsed.sentiment,
        suggested_actions: parsed.suggested_actions ?? [],
        model: `agent:${ANALYSIS_AGENT_ID}`,
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
