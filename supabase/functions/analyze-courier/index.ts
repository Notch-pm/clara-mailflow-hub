import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import JSZip from "https://esm.sh/jszip@3.10.1";
import { extractText, getDocumentProxy } from "https://esm.sh/unpdf@0.12.1";
import {
  AiQuotaExceededError,
  FEATURE_ANALYSIS,
  isAiConfigured,
  MAX_OCR_PAGES,
  SocleAiError,
  socleOcr,
  socleOrgIdFor,
  type SocleAiContext,
} from "../_shared/socleAi.ts";
import { assertEditor } from "../_shared/authz.ts";
import { analysisRow, runCourierAnalysis } from "../_shared/courierAnalysisCore.ts";
import { canReadCourier } from "../_shared/courierAccess.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-org-id, x-cron-secret",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const BUCKET = "clara-documents";
/**
 * Modèle inscrit dans `courier_document_extracts.model` quand le texte vient
 * du guichet. Ce n'est plus le nom d'un modèle de fournisseur : Clara ne le
 * connaît plus, et le Socle peut en changer sans qu'elle bouge.
 */
const OCR_MODEL = "socle-ocr";
/** Durée de vie du lien remis au guichet : le temps de l'appel, pas plus. */
const SIGNED_URL_TTL_SECONDS = 600;

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

/** Secret cron partagé, lu depuis le Vault Postgres (même source que
 *  fetch-inbound-emails). Autorise les appels SYSTÈME, sans utilisateur. */
async function getCronSecret(admin: ReturnType<typeof getAdminClient>): Promise<string> {
  try {
    const { data, error } = await admin.rpc("get_cron_secret");
    if (error) {
      console.error("get_cron_secret RPC error:", error.message);
      return "";
    }
    return (data as string) ?? "";
  } catch (e) {
    console.error("get_cron_secret exception:", e);
    return "";
  }
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

/**
 * Le texte d'un document, stocké dans `courier_document_extracts`.
 *
 * ⚠️ L'ORDRE DES BRANCHES EST UNE DÉCISION DE COÛT, pas de commodité. Texte
 * brut, DOCX, ODT, RTF et PDF avec couche texte s'extraient ICI, sans IA et
 * sans toucher au crédit de la collectivité. Le guichet n'est appelé que pour
 * ce qui l'exige : PDF scanné et image. Chaque appel évité est du crédit qui
 * reste disponible pour l'analyse elle-même.
 */
async function ocrDocument(
  admin: ReturnType<typeof getAdminClient>,
  orgId: string,
  documentId: string,
  /** Imputation de la dépense. `actorId` NULL pour un appel système (cron). */
  ctx: SocleAiContext,
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
      // PDF scanné : rien à extraire nativement, le guichet est le seul recours.
      //
      // ⚠️ LE LIEN SIGNÉ EST UN DROIT D'ACCÈS AU DOCUMENT. Il est émis juste
      // avant l'appel et vit le temps de l'appel. Le Socle ne télécharge pas
      // le document : il transmet le lien au fournisseur, qui va le chercher
      // lui-même — l'octet ne traverse donc jamais le Socle.
      const { data: signed, error: signErr } = await admin.storage
        .from(BUCKET)
        .createSignedUrl(doc.storage_key, SIGNED_URL_TTL_SECONDS);
      if (signErr || !signed) throw new Error(`Signed URL error: ${signErr?.message}`);

      const ocrOutcome = await socleOcr({
        ctx: { ...ctx, reference: { kind: "courier", id: doc.courier_id } },
        documentType: "document_url",
        url: signed.signedUrl,
        // Le nombre de pages compté nativement sert à RÉSERVER chez le Socle.
        // Borné : au-delà, le guichet refuserait le document entier plutôt que
        // d'en rendre une partie.
        pageCountHint: Math.min(pageCount ?? 1, MAX_OCR_PAGES),
      });
      extractedText = ocrOutcome.text;
      pageCount = ocrOutcome.pageCount ?? pageCount;
      model = OCR_MODEL;
    }
  } else {
    // Images et formats inconnus : aucune extraction native possible, le
    // guichet est le seul recours. Même règle que la branche PDF — le lien
    // signé est émis juste avant l'appel, et le Socle ne le télécharge pas.
    const { data: signed, error: signErr } = await admin.storage
      .from(BUCKET)
      .createSignedUrl(doc.storage_key, SIGNED_URL_TTL_SECONDS);
    if (signErr || !signed) throw new Error(`Signed URL error: ${signErr?.message}`);

    const ocrOutcome = await socleOcr({
      ctx: { ...ctx, reference: { kind: "courier", id: doc.courier_id } },
      documentType: isImage ? "image_url" : "document_url",
      url: signed.signedUrl,
    });
    extractedText = ocrOutcome.text;
    pageCount = ocrOutcome.pageCount;
    model = OCR_MODEL;
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

/**
 * Analyse d'un courrier existant : relit ses extraits et son corps, confie
 * l'analyse au cœur commun (`_shared/courierAnalysisCore.ts`, partagé avec
 * l'écran de création), puis l'enregistre.
 */
async function analyzeCourier(
  admin: ReturnType<typeof getAdminClient>,
  orgId: string,
  courierId: string,
  /** Imputation de la dépense. `actorId` NULL pour un appel système (cron). */
  ctx: SocleAiContext,
) {
  const { data: courier } = await admin
    .from("couriers")
    .select("id, subject, organization_id, channel, metadata, socle_organization_id")
    .eq("id", courierId)
    .single();
  if (!courier || courier.organization_id !== orgId) throw new Error("Courier not found");

  const { data: extracts } = await admin
    .from("courier_document_extracts")
    .select("text, document_id")
    .eq("courier_id", courierId)
    .eq("organization_id", orgId);

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

  const concatenated = (extracts ?? [])
    .map((e) => e.text)
    .filter(Boolean)
    .join("\n\n===\n\n");

  const analysis = await runCourierAnalysis(
    admin,
    orgId,
    { subject: courier.subject ?? null, body: bodyText || bodyFromHtml, attachmentsText: concatenated },
    {
      currentServiceOrgId: courier.socle_organization_id ?? null,
      ctx: { ...ctx, reference: { kind: "courier", id: courierId } },
    },
  );

  const { data: row, error: upErr } = await admin
    .from("courier_analyses")
    .upsert(
      {
        courier_id: courierId,
        organization_id: orgId,
        ...analysisRow(analysis),
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
    const admin = getAdminClient();
    const orgId = req.headers.get("x-org-id");
    if (!orgId) return jsonResponse({ error: "Missing x-org-id header" }, 400);

    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRe.test(orgId)) return jsonResponse({ error: "Invalid x-org-id" }, 400);

    // Deux appelants possibles :
    //  - un utilisateur (JWT + appartenance à l'organisation vérifiée) ;
    //  - le worker de file d'attente (x-cron-secret), qui n'a pas d'utilisateur.
    // Sans cette seconde branche, aucun ingesteur serveur ne peut océriser :
    // c'est ce qui empêchait la boîte de numérisation de fonctionner seule.
    // userId reste NULL côté quota — ai_usage_events.created_by est nullable.
    // Le contrôle consultant ne s'applique QU'à la branche utilisateur : le
    // worker cron (process-analysis-queue) tourne en service système, sans
    // notion de rôle, et doit rester intact.
    const cronSecret = req.headers.get("x-cron-secret");
    let userId: string | null = null;
    if (cronSecret) {
      const expected = await getCronSecret(admin);
      if (!expected || cronSecret !== expected) throw new Error("Unauthorized");
    } else {
      const user = await verifyAuth(req);
      await verifyOrgMembership(admin, user.id, orgId);
      // Le consultant est en lecture seule : pas d'OCR ni d'analyse IA lancés par lui.
      if (!(await assertEditor(admin, user.id, orgId))) {
        throw new Error("Forbidden: Accès refusé : rôle consultant en lecture seule");
      }
      userId = user.id;
    }

    const url = new URL(req.url);
    const action = url.searchParams.get("action");

    // ⚠️ LE ROUTAGE D'ABORD, LE RACCORDEMENT ENSUITE, et l'ordre est une
    // décision. Une action inconnue est inconnue, que l'instance soit
    // raccordée au guichet IA ou non : la renvoyer en 503 ferait chercher une
    // panne de configuration là où il n'y a qu'une faute de frappe. On ne
    // vérifie donc le raccordement qu'une fois établi que l'appel va dépenser.
    if (action !== "ocr-courier" && action !== "analyze") {
      return jsonResponse({ error: "Unknown action" }, 400);
    }

    // ⚠️ Ce n'est PAS la clé d'un fournisseur — Clara n'en a plus. C'est le
    // raccordement au guichet IA du Socle, qui détient la clé et le crédit.
    if (!isAiConfigured()) {
      return jsonResponse({ error: "L'assistant IA n'est pas configuré sur cette instance." }, 503);
    }
    const socleOrgId = await socleOrgIdFor(admin, orgId);
    if (!socleOrgId) {
      return jsonResponse(
        { error: "Organisation non rattachée au Socle (socle_org_id manquant) — la consommation IA ne serait imputable à personne." },
        503,
      );
    }
    // `actorId` NULL sur la branche cron : le worker n'a pas d'utilisateur.
    // Le garde-fou de cadence du Socle bascule alors sur le quota « par
    // application » (plus large), ce qui est exactement ce qu'il faut pour un
    // traitement de lot.
    const aiContext: SocleAiContext = {
      socleOrgId,
      feature: FEATURE_ANALYSIS,
      actorId: userId,
    };

    if (req.method === "POST" && action === "ocr-courier") {
      const { courier_id } = await req.json();
      if (!courier_id) return jsonResponse({ error: "Missing courier_id" }, 400);
      // Courrier confidentiel : l'appelant doit pouvoir le lire (le cron, lui, n'a pas d'utilisateur).
      if (userId && !(await canReadCourier(req.headers.get("authorization"), courier_id))) {
        return jsonResponse({ error: "Courrier confidentiel : accès refusé" }, 403);
      }

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
      let quotaExceeded = false;
      for (const d of docs) {
        if (quotaExceeded) {
          results.push({ document_id: d.id, ok: false, error: "quota_exceeded" });
          continue;
        }
        try {
          await ocrDocument(admin, orgId, d.id, aiContext);
          results.push({ document_id: d.id, ok: true });
        } catch (e) {
          if (e instanceof AiQuotaExceededError) quotaExceeded = true;
          const msg = e instanceof Error ? e.message : "unknown";
          console.error(`OCR doc ${d.id} failed:`, msg);
          results.push({ document_id: d.id, ok: false, error: msg });
        }
      }
      return jsonResponse({ results, quotaExceeded });
    }

    if (req.method === "POST" && action === "analyze") {
      const { courier_id } = await req.json();
      if (!courier_id) return jsonResponse({ error: "Missing courier_id" }, 400);
      // Courrier confidentiel : l'appelant doit pouvoir le lire (le cron, lui, n'a pas d'utilisateur).
      if (userId && !(await canReadCourier(req.headers.get("authorization"), courier_id))) {
        return jsonResponse({ error: "Courrier confidentiel : accès refusé" }, 403);
      }
      const row = await analyzeCourier(admin, orgId, courier_id, aiContext);
      return jsonResponse(row);
    }

    return jsonResponse({ error: "Unknown action" }, 400);
  } catch (err) {
    // Les refus du guichet arrivent déjà traduits, avec leur statut : plafond
    // de la collectivité atteint (message du Socle mot pour mot, date de
    // renouvellement comprise), cadence dépassée, fournisseur muet,
    // configuration absente.
    if (err instanceof SocleAiError) {
      return jsonResponse({
        error: err.message,
        code: err.code,
        // La date vient du Socle, jamais recalculée ici : l'appelant (écran ou
        // worker de file) doit pouvoir la relayer sans risquer de la contredire.
        renews_at: err instanceof AiQuotaExceededError ? err.renewsAt : null,
      }, err.status);
    }
    const message = err instanceof Error ? err.message : "Internal error";
    const status =
      message === "Unauthorized" ? 401
      : message.startsWith("Forbidden") ? 403
      : 500;
    return jsonResponse({ error: message }, status);
  }
});
