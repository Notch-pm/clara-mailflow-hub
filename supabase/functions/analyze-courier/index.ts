import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import JSZip from "https://esm.sh/jszip@3.10.1";
import { extractText, getDocumentProxy } from "https://esm.sh/unpdf@0.12.1";
import {
  AGENT_EXTRACTION,
  AiQuotaExceededError,
  FEATURE_ANALYSIS,
  FEATURE_PREFILL,
  fitMessage,
  isAiConfigured,
  MAX_OCR_PAGES,
  MAX_OUTPUT_TOKENS,
  parseJsonAnswer,
  SocleAiError,
  socleCompletion,
  socleOcr,
  socleOrgIdFor,
  type SocleAiContext,
} from "../_shared/socleAi.ts";
import { jsonSchemaInstruction, objectSchema } from "../_shared/jsonSchemaPrompt.ts";
import {
  SUGGESTED_FIELDS_PROPERTIES,
  SUGGESTED_FIELDS_KEYS,
  SUGGESTED_FIELDS_PROMPT_RULES,
  nullIfEmpty,
  cleanSenderFields,
  hasSenderData,
} from "../_shared/courierFieldSuggestions.ts";
import {
  buildServiceCatalog,
  resolveSuggestedService,
  selectServiceCandidates,
  serviceSuggestionPromptRules,
  SERVICE_SUGGESTION_PROPERTY,
  type ServiceCandidate,
} from "../_shared/serviceSuggestion.ts";
import {
  attachSoclePrefill,
  buildProcedureCatalog,
  planPrefillCalls,
  resolveSuggestedOrganization,
  sanitizePrefillArguments,
  selectPrefillCandidates,
  splitPrefillCall,
  type OrganizationRef,
  type PrefillCall,
  type PrefillProcedureSource,
  type ProcedureCatalogEntry,
  type SanitizedPrefill,
} from "./logic.ts";
import { assertEditor } from "../_shared/authz.ts";

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

/** Run analysis using all extracts of a courier. */
async function analyzeCourier(
  admin: ReturnType<typeof getAdminClient>,
  orgId: string,
  courierId: string,
  /** Imputation de la dépense. `actorId` NULL pour un appel système (cron). */
  ctx: SocleAiContext,
) {
  // Get courier subject + extracts
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

  // Tags disponibles dans l'organisation — le LLM ne peut choisir QUE parmi
  // ceux-ci, et EN DEUX LISTES : le thème dit de quoi parle le courrier, le
  // sentiment sur quel ton. Mêlés, le modèle en choisissait cinq du même bord.
  const { data: orgTags } = await admin
    .from("courier_tags")
    .select("name, tag_group")
    .eq("organization_id", orgId);
  const tagRows = (orgTags ?? []) as Array<{ name: string; tag_group: string }>;
  const namesOfGroup = (group: string) =>
    tagRows
      .filter((t) => (t.tag_group ?? "theme") === group)
      .map((t) => t.name)
      .filter((n) => typeof n === "string" && n.trim().length > 0);
  const themeTagNames = namesOfGroup("theme");
  const sentimentTagNames = namesOfGroup("sentiment");
  // Ce qui est appliqué au courrier reste UNE liste de noms : le groupe est une
  // propriété du tag, pas de son application (cf. src/lib/courier-tags.ts).
  const availableTagNames = [...themeTagNames, ...sentimentTagNames];

  // Démarches disponibles — données Socle incluses : descriptions/mots-clés
  // pour la pertinence des recommandations, form_schema/knowledge_base pour
  // l'appel de préremplissage ciblé.
  const { data: orgProcedures } = await admin
    .from("procedures")
    .select(
      "id, name, external_source, external_reference_id, arpege_config_fields, keywords, agent_description, description, form_schema, knowledge_base",
    )
    .eq("organization_id", orgId)
    .eq("is_displayed", true)
    .is("obsoleted_at", null) // exclut les démarches retirées du Socle (soft-delete)
    .order("display_order", { ascending: true });
  const procedureList = (orgProcedures ?? []) as Array<
    ProcedureCatalogEntry & PrefillProcedureSource
  >;

  // Organisations disponibles (miroir Socle) : destinataires des démarches, et
  // catalogue décrit pour proposer le service instructeur.
  const { data: socleOrgRows } = await admin
    .from("socle_organizations")
    .select("id, name, socle_id, socle_parent_id, public_description, workflow_id")
    .eq("organization_id", orgId)
    .eq("status", "active")
    .is("obsoleted_at", null);

  // Qui assure quoi (miroir `procedure_organizations`) : le modèle doit choisir
  // l'organisation DANS cette liste, sans quoi Iris refuse le dépôt.
  const knownOrgs = new Map<string, OrganizationRef>(
    (socleOrgRows ?? []).map((o: OrganizationRef) => [o.id, { id: o.id, name: o.name }]),
  );
  const { data: activationRows } = await admin
    .from("procedure_organizations")
    .select("procedure_id, socle_organization_id")
    .eq("organization_id", orgId)
    .is("obsoleted_at", null);
  const orgsByProcedure = new Map<string, OrganizationRef[]>();
  for (const row of (activationRows ?? []) as Array<{ procedure_id: string; socle_organization_id: string }>) {
    const org = knownOrgs.get(row.socle_organization_id);
    if (!org) continue; // organisation obsolète : plus proposable
    const list = orgsByProcedure.get(row.procedure_id) ?? [];
    list.push(org);
    orgsByProcedure.set(row.procedure_id, list);
  }
  for (const proc of procedureList) {
    proc.organizations = orgsByProcedure.get(proc.id) ?? [];
  }

  // Service instructeur : le catalogue dit ce que fait chaque organisation
  // (descriptif du Socle + démarches qu'elle instruit). L'organisation déjà
  // désignée y reste toujours, pour que le modèle puisse la confirmer.
  const allServiceOrgs = (socleOrgRows ?? []) as ServiceCandidate[];
  const currentServiceOrg = allServiceOrgs.find((o) => o.id === courier.socle_organization_id) ?? null;
  const serviceCandidates = selectServiceCandidates(allServiceOrgs);
  if (currentServiceOrg && !serviceCandidates.some((o) => o.id === currentServiceOrg.id)) {
    serviceCandidates.push(currentServiceOrg);
  }
  const procedureNamesByOrg = new Map<string, string[]>();
  for (const proc of procedureList) {
    for (const o of proc.organizations ?? []) {
      const list = procedureNamesByOrg.get(o.id) ?? [];
      list.push(proc.name);
      procedureNamesByOrg.set(o.id, list);
    }
  }
  const serviceCatalogForPrompt = buildServiceCatalog(serviceCandidates, procedureNamesByOrg, allServiceOrgs);

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

  const listForPrompt = (names: string[], empty: string) =>
    names.length > 0 ? names.map((n) => `- ${n}`).join("\n") : empty;
  const themeListForPrompt = listForPrompt(themeTagNames, "(aucun thème défini — laisse intents vide)");
  const sentimentListForPrompt = listForPrompt(
    sentimentTagNames,
    "(aucun sentiment défini — laisse sentiments vide)",
  );

  const procedureListForPrompt = buildProcedureCatalog(procedureList);

  const systemPrompt = `Tu es un assistant expert en gestion de courrier administratif. Analyse le contenu fourni et restitue les éléments suivants :
- summary: résumé concis (2-3 phrases) du contenu
- intents: les THÈMES du courrier — de quoi il parle. Choisis EXCLUSIVEMENT dans la liste des thèmes disponibles ci-dessous (copie exacte du nom, sensible à la casse). N'invente AUCUN tag. Si aucun ne s'applique, renvoie une liste vide.
- sentiments: le TON du rédacteur. Choisis EXCLUSIVEMENT dans la liste des sentiments disponibles ci-dessous (copie exacte du nom). En règle générale UN SEUL suffit, deux au maximum quand le courrier est franchement partagé. Liste vide si le ton n'est pas lisible.
- suggested_actions: 2 à 5 actions concrètes que l'organisation devrait entreprendre. Pour chaque action :
  • label: description courte de l'action
  • procedure_id: si une démarche de la liste correspond réellement à l'action (vérifie la cohérence avec sa description et ses mots-clés, pas seulement son nom), indique son id exact. Sinon null. Ne force jamais une correspondance approximative.
  • socle_organization_id: organisation à qui adresser la demande. Choisis-la EXCLUSIVEMENT parmi celles listées après « assurée par » sur la démarche retenue (copie l'id exact indiqué par « [org: … ] »), en te fondant sur le lieu ou le service concerné par le courrier. Si aucune ne s'impose, ou si l'action ne porte aucune démarche, renvoie null. N'invente jamais d'organisation.
  • prefill: si des données personnelles sont identifiables dans le courrier (nom, prénom, email, téléphone, date de naissance, civilité), extrais-les ici pour pré-remplir le formulaire. N'invente aucune donnée absente du courrier.
${SUGGESTED_FIELDS_PROMPT_RULES}
${serviceSuggestionPromptRules(currentServiceOrg ? { id: currentServiceOrg.id, name: currentServiceOrg.name } : null)}
Sois factuel, en français. Si le corps de l'email et les pièces jointes coexistent, traite-les comme un tout cohérent. Ne retourne que ce qui est clairement identifiable — ne devine rien.

Thèmes disponibles pour intents :
${themeListForPrompt}

Sentiments disponibles pour sentiments :
${sentimentListForPrompt}

Procédures disponibles (utilise l'id exact pour procedure_id) :
${procedureListForPrompt}

Organisations (catalogue pour suggested_service) :
${serviceCatalogForPrompt}`;

  const sections: string[] = [`Sujet du courrier : ${courier.subject ?? "(aucun)"}`];
  if (emailBody.trim()) {
    sections.push(`Corps de l'email :\n${emailBody}`);
  }
  if (concatenated.trim()) {
    sections.push(`Contenu extrait des pièces jointes :\n${concatenated}`);
  }
  const userPrompt = sections.join("\n\n");

  const namesSchema = (names: string[]): Record<string, unknown> => ({
    type: "array",
    items: names.length > 0 ? { type: "string", enum: names } : { type: "string" },
  });
  const intentsSchema = namesSchema(themeTagNames);
  const sentimentsSchema = namesSchema(sentimentTagNames);

  // ⚠️ CE SCHÉMA VIVAIT DANS `tools`. Il n'a pas disparu avec la
  // centralisation : il a changé de place. Le guichet du Socle refuse
  // `tools`/`tool_choice` par principe et n'offre que « du JSON valide » —
  // la conformité au schéma reste donc l'affaire de Clara, comme elle l'était
  // déjà en pratique (un schéma d'outil n'a jamais empêché un modèle
  // d'inventer un `procedure_id` bien formé mais inexistant). Les deux
  // revalidations qui suivent — tags de l'organisation, démarches existantes —
  // sont et restent la vraie défense.
  const analysisSchema = objectSchema(
    {
      summary: { type: "string" },
      intents: intentsSchema,
      sentiments: sentimentsSchema,
      ...SUGGESTED_FIELDS_PROPERTIES,
      ...SERVICE_SUGGESTION_PROPERTY,
      suggested_actions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            label: { type: "string", description: "Action concrète à entreprendre" },
            procedure_id: { type: ["string", "null"], description: "ID exact de la procédure correspondante, ou null" },
            socle_organization_id: {
              type: ["string", "null"],
              description: "ID exact de l'organisation qui assure cette démarche, ou null",
            },
            prefill: {
              type: "object",
              description: "Données extractibles du courrier pour pré-remplir le formulaire demandeur",
              properties: {
                CIVILITE: { type: "string", enum: ["M", "MME", "MLLE"] },
                NOM_USUEL: { type: "string" },
                NOM_NAISSANCE: { type: "string" },
                PRENOMS: { type: "string" },
                DATE_NAISSANCE: { type: "string", description: "Format YYYY-MM-DD" },
                EMAIL: { type: "string" },
                TEL_FIXE: { type: "string" },
                TEL_MOBILE: { type: "string" },
              },
              additionalProperties: false,
            },
          },
          required: ["label"],
          additionalProperties: false,
        },
      },
    },
    ["summary", "intents", "sentiments", "suggested_actions", "suggested_service", ...SUGGESTED_FIELDS_KEYS],
  );

  type ParsedAnalysis = {
    summary: string;
    intents: string[];
    sentiments: string[];
    suggested_actions: Array<{
      label: string;
      procedure_id?: string | null;
      socle_organization_id?: string | null;
      prefill?: Record<string, string>;
    }>;
    suggested_subject?: string;
    suggested_service?: unknown;
    recipient_name?: string;
    sender_first_name?: string;
    sender_last_name?: string;
    sender_email?: string;
    sender_phone?: string;
  };

  const analysisAnswer = await socleCompletion({
    system: `${systemPrompt}

${jsonSchemaInstruction(analysisSchema)}`,
    messages: [{ role: "user", content: fitMessage(userPrompt) }],
    agent: AGENT_EXTRACTION,
    // ⚠️ LE PLAFOND DE SORTIE, ET NON UNE ESTIMATION SERRÉE. Règle maison pour
    // tout appel `json: true` : une réponse JSON tronquée est une PERTE TOTALE
    // (elle ne parse pas, tout l'appel est à rejouer), tandis qu'une
    // réservation trop haute est rendue au règlement — le Socle solde sur la
    // consommation réelle. Les deux risques ne sont pas du même ordre.
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    json: true,
    ctx: { ...ctx, feature: FEATURE_ANALYSIS, reference: { kind: "courier", id: courierId } },
  });
  const parsed = parseJsonAnswer<ParsedAnalysis>(analysisAnswer);

  // Sécurité : ne garder que les tags qui appartiennent bien à l'organisation,
  // ET AU BON GROUPE — un modèle à qui l'on donne deux listes range parfois un
  // sentiment dans les thèmes. Mapping strict, insensible à la casse.
  const keepFrom = (names: string[], proposed: unknown): string[] => {
    const allowed = new Set(names.map((n) => n.toLowerCase()));
    return Array.isArray(proposed)
      ? proposed.filter((i): i is string => typeof i === "string" && allowed.has(i.toLowerCase()))
      : [];
  };
  // Les deux groupes se rejoignent dans UNE liste : ce qui est appliqué au
  // courrier est une liste de noms, le groupe se relit dans le référentiel.
  const safeIntents = [
    ...keepFrom(themeTagNames, parsed.intents),
    ...keepFrom(sentimentTagNames, parsed.sentiments),
  ];

  // Sécurité : s'assurer que les procedure_id retournés par le LLM appartiennent bien à l'org
  const validProcedureIds = new Set(procedureList.map((p) => p.id));
  const procedureById = new Map(procedureList.map((p) => [p.id, p.name]));
  const safeActions = Array.isArray(parsed.suggested_actions)
    ? parsed.suggested_actions.map((a) => {
        const validId = a.procedure_id && validProcedureIds.has(a.procedure_id) ? a.procedure_id : null;
        // Organisation destinataire : revalidée contre le miroir d'activation,
        // et imposée d'office quand une seule organisation assure la démarche.
        const org = resolveSuggestedOrganization(
          a.socle_organization_id,
          validId ? (orgsByProcedure.get(validId) ?? []) : [],
          knownOrgs,
        );
        return {
          label: a.label ?? "",
          procedure_id: validId,
          procedure_name: validId ? (procedureById.get(validId) ?? null) : null,
          socle_organization_id: org?.id ?? null,
          socle_organization_name: org?.name ?? null,
          prefill: a.prefill ?? {},
        };
      })
    : [];

  // ── Appel(s) 2 (ciblés, non bloquants) : préremplissage des démarches Socle ──
  // Uniquement pour les démarches Socle natives recommandées ayant des champs
  // de formulaire. Le schéma de sortie est généré depuis leur form_schema
  // (labels et options portés par le schéma, pas de rappel dans le prompt) et
  // joint au prompt système depuis la centralisation IA ; au-delà
  // d'un seuil de taille, la planification scinde en un appel par démarche, et
  // un appel groupé qui échoue est rejoué scindé. La sortie est revalidée avant
  // stockage. En cas d'échec final, l'analyse est stockée sans socle_prefill.
  let actionsToStore: Array<(typeof safeActions)[number] & { socle_prefill?: unknown }> = safeActions;
  const prefillCandidates = selectPrefillCandidates(safeActions, procedureList);
  const prefillQueue: PrefillCall[] = planPrefillCalls(prefillCandidates);
  if (prefillQueue.length > 1) {
    console.warn(`report_prefill: schéma trop large — scission en ${prefillQueue.length} appels`);
  }

  const runPrefillCall = async (call: PrefillCall): Promise<unknown> => {
    const prefillSystemPrompt = `Tu prépares le préremplissage de formulaires de démarches administratives à partir du contenu d'un courrier.
Pour chaque démarche :
- audience : nature du demandeur (citoyen, entreprise ou association) si elle est claire d'après le courrier, sinon chaîne vide.
- form : pour chaque champ, la valeur extraite du courrier. N'invente RIEN : chaîne vide (ou tableau vide) pour tout champ dont la valeur n'est pas clairement présente. Champs à options : le CODE exact, jamais le libellé. Dates au format YYYY-MM-DD.
Appuie-toi sur les connaissances fournies pour interpréter les champs, et respecte les garde-fous.

${call.tool.promptBlock}

${jsonSchemaInstruction(call.tool.toolParameters as Record<string, unknown>)}`;
    const prefillUserPrompt = userPrompt.slice(0, call.contentMax);

    const answer = await socleCompletion({
      system: prefillSystemPrompt,
      messages: [{ role: "user", content: fitMessage(prefillUserPrompt) }],
      agent: AGENT_EXTRACTION,
      // Le plafond, pour la même raison que l'analyse ci-dessus.
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      json: true,
      ctx: { ...ctx, feature: FEATURE_PREFILL, reference: { kind: "courier", id: courierId } },
    });
    return parseJsonAnswer<unknown>(answer);
  };

  const sanitizedAll: Record<string, SanitizedPrefill> = {};
  while (prefillQueue.length > 0) {
    const call = prefillQueue.shift()!;
    try {
      const rawPrefill = await runPrefillCall(call);
      Object.assign(sanitizedAll, sanitizePrefillArguments(rawPrefill, call.procedures));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (e instanceof AiQuotaExceededError) {
        console.warn("report_prefill interrompu (quota IA atteint):", msg);
        break;
      }
      const split = splitPrefillCall(call);
      if (split.length > 0) {
        console.warn(`report_prefill groupé échoué — repli en ${split.length} appels scindés:`, msg);
        prefillQueue.push(...split);
      } else {
        console.warn("report_prefill échoué (non bloquant):", msg);
      }
    }
  }
  if (Object.keys(sanitizedAll).length > 0) {
    actionsToStore = attachSoclePrefill(safeActions, sanitizedAll);
  }

  // Sécurité : le service proposé doit appartenir au catalogue (id revalidé).
  const serviceSuggestion = resolveSuggestedService(parsed.suggested_service, serviceCandidates);
  const safeSuggestedSubject = nullIfEmpty(parsed.suggested_subject);
  const safeSuggestedRecipient = nullIfEmpty(parsed.recipient_name);
  const cleanSender = cleanSenderFields(parsed);
  const safeSuggestedSender = hasSenderData(cleanSender) ? cleanSender : null;

  const { data: row, error: upErr } = await admin
    .from("courier_analyses")
    .upsert(
      {
        courier_id: courierId,
        organization_id: orgId,
        summary: parsed.summary,
        intents: safeIntents,
        // `sentiment` (colonne de l'ancien champ figé) n'est plus écrite depuis
        // le 2026-09-10 : le sentiment est un tag, rangé dans `intents`. La
        // colonne subsiste pour les analyses antérieures.
        suggested_actions: actionsToStore,
        suggested_subject: safeSuggestedSubject,
        // Le nom reste écrit pour l'existant ; l'identifiant et la raison
        // portent la proposition depuis le 2026-10-01.
        suggested_service_name: serviceSuggestion?.name ?? null,
        suggested_socle_organization_id: serviceSuggestion?.id ?? null,
        suggested_service_reason: serviceSuggestion?.reason ?? null,
        suggested_recipient_name: safeSuggestedRecipient,
        suggested_sender: safeSuggestedSender,
        // ⚠️ NI MODÈLE NI JETONS : Clara ne les connaît plus, et c'est
        // voulu. Le modèle est choisi par le Socle derrière un alias, et le
        // décompte vit dans son journal (`ai_usage_events`), avec la
        // ventilation par application. Recopier ici un nombre approché
        // créerait le second compteur que la centralisation a supprimé — et
        // un chiffre faux est pire qu'un chiffre absent : on ne se méfie pas
        // d'un tableau qui s'affiche.
        model: "socle:ai-api",
        tokens_used: null,
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
