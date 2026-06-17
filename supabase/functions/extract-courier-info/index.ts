import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { withAiUsageGuard, AiQuotaExceededError, estimateOcrTokens, estimateTextTokens, estimateTokensFromText } from "../_shared/aiUsage.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-org-id",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const BUCKET = "clara-documents";
const MISTRAL_OCR_URL = "https://api.mistral.ai/v1/ocr";
const MISTRAL_AGENT_URL = "https://api.mistral.ai/v1/agents/completions";
const OCR_MODEL = "mistral-ocr-latest";
const ANALYSIS_AGENT_ID = "ag_019d9b92d28872079534f45f246671ed";

interface FileInput {
  name: string;
  mime_type: string;
  content_base64: string;
}

interface ExtractedInfo {
  sender_first_name: string | null;
  sender_last_name: string | null;
  sender_email: string | null;
  sender_phone: string | null;
  recipient_name: string | null;
  suggested_service_name: string | null;
  suggested_tag_names: string[];
}

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

async function ocrFile(
  admin: ReturnType<typeof getAdminClient>,
  orgId: string,
  file: FileInput,
  mistralKey: string,
  userId: string,
): Promise<string> {
  const mime = file.mime_type.toLowerCase();
  const name = file.name.toLowerCase();

  if (mime.startsWith("text/")) {
    return atob(file.content_base64);
  }

  if (mime.startsWith("image/")) {
    const dataUri = `data:${file.mime_type};base64,${file.content_base64}`;
    return await withAiUsageGuard({
      admin,
      organizationId: orgId,
      provider: "mistral",
      resourceType: "ocr",
      estimatedTokens: estimateOcrTokens(1),
      userId,
      run: async () => {
        const resp = await fetch(MISTRAL_OCR_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${mistralKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: OCR_MODEL,
            document: { type: "image_url", image_url: dataUri },
            include_image_base64: false,
          }),
        });
        if (!resp.ok) {
          const t = await resp.text();
          throw new Error(`OCR image failed (${resp.status}): ${t.slice(0, 200)}`);
        }
        const data = await resp.json();
        const text = (data.pages ?? [])
          .map((p: { markdown?: string; text?: string }) => p.markdown ?? p.text ?? "")
          .join("\n\n");
        const actualTokens = data?.usage?.total_tokens ?? estimateTokensFromText(text);
        return { result: text, actualTokens };
      },
    });
  }

  if (mime === "application/pdf" || name.endsWith(".pdf")) {
    const tempKey = `${orgId}/temp/${crypto.randomUUID()}-${file.name}`;
    const bytes = Uint8Array.from(atob(file.content_base64), (c) => c.charCodeAt(0));

    const { error: upErr } = await admin.storage.from(BUCKET).upload(tempKey, bytes, {
      contentType: file.mime_type,
      upsert: false,
    });
    if (upErr) throw new Error(`Temp upload failed: ${upErr.message}`);

    try {
      const { data: signed, error: signErr } = await admin.storage
        .from(BUCKET)
        .createSignedUrl(tempKey, 300);
      if (signErr || !signed) throw new Error(`Signed URL error: ${signErr?.message}`);

      return await withAiUsageGuard({
        admin,
        organizationId: orgId,
        provider: "mistral",
        resourceType: "ocr",
        estimatedTokens: estimateOcrTokens(1),
        userId,
        run: async () => {
          const resp = await fetch(MISTRAL_OCR_URL, {
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
          if (!resp.ok) {
            const t = await resp.text();
            throw new Error(`OCR PDF failed (${resp.status}): ${t.slice(0, 200)}`);
          }
          const data = await resp.json();
          const text = (data.pages ?? [])
            .map((p: { markdown?: string; text?: string }) => p.markdown ?? p.text ?? "")
            .join("\n\n");
          const actualTokens = data?.usage?.total_tokens ?? estimateTokensFromText(text);
          return { result: text, actualTokens };
        },
      });
    } finally {
      await admin.storage.from(BUCKET).remove([tempKey]);
    }
  }

  return "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const user = await verifyAuth(req);
    const admin = getAdminClient();
    const orgId = req.headers.get("x-org-id");
    if (!orgId) return jsonResponse({ error: "Missing x-org-id header" }, 400);

    await verifyOrgMembership(admin, user.id, orgId);

    const mistralKey = Deno.env.get("MISTRAL_API_KEY");
    if (!mistralKey) return jsonResponse({ error: "MISTRAL_API_KEY non configurée" }, 500);

    const { files } = (await req.json()) as { files: FileInput[] };
    if (!files?.length) return jsonResponse({ error: "No files provided" }, 400);

    // OCR each file (up to first 5 to cap cost)
    const texts: string[] = [];
    let quotaExceeded = false;
    for (const file of files.slice(0, 5)) {
      try {
        const text = await ocrFile(admin, orgId, file, mistralKey, user.id);
        if (text.trim()) texts.push(text.trim());
      } catch (e) {
        if (e instanceof AiQuotaExceededError) {
          // Contrairement aux autres erreurs OCR par fichier (avalées en
          // silence, traitement best-effort), le quota dépassé concerne
          // l'organisation entière : inutile de continuer la boucle, les
          // fichiers suivants échoueraient tous pour la même raison.
          quotaExceeded = true;
          break;
        }
        console.error(`OCR failed for ${file.name}:`, (e as Error).message);
      }
    }

    if (quotaExceeded && !texts.length) {
      return jsonResponse({ error: "quota_exceeded" }, 429);
    }

    if (!texts.length) return jsonResponse({ error: "Aucun texte extrait des documents" }, 400);

    const extractedText = texts.join("\n\n===\n\n");
    const combinedText = extractedText.slice(0, 30_000);

    // Load org context for the LLM
    const [{ data: orgServices }, { data: orgTags }] = await Promise.all([
      admin.from("services").select("name").eq("organization_id", orgId),
      admin.from("courier_tags").select("name").eq("organization_id", orgId),
    ]);

    const serviceNames: string[] = (orgServices ?? []).map((s: { name: string }) => s.name);
    const tagNames: string[] = (orgTags ?? []).map((t: { name: string }) => t.name);

    const tagListForPrompt = tagNames.length > 0
      ? tagNames.map((n) => `- ${n}`).join("\n")
      : "(aucun tag défini — laisse suggested_tag_names vide)";

    const systemPrompt = `Tu es un assistant expert en gestion de courrier administratif français.
Analyse le texte extrait d'un courrier et utilise l'outil "extract_info" pour retourner les informations structurées.
Règles :
- Ne retourne QUE ce qui est clairement identifiable dans le texte. Ne devine rien.
- suggested_service_name : choisis UNIQUEMENT parmi la liste fournie, ou null si aucun ne correspond clairement.
- suggested_tag_names : choisis EXCLUSIVEMENT dans la liste des tags disponibles ci-dessous (copie exacte du nom, sensible à la casse). N'invente AUCUN tag. Liste vide si aucun ne correspond.
- Pour le destinataire : c'est la personne ou le service à qui s'adresse le courrier (ex: "Monsieur le Maire", "Direction des Travaux").
- Pour l'expéditeur : c'est l'auteur/signataire du courrier.

Services disponibles : ${serviceNames.length ? serviceNames.join(", ") : "(aucun)"}

Tags disponibles pour suggested_tag_names :
${tagListForPrompt}`;

    const userPrompt = `Texte extrait du courrier :
${combinedText}`;

    // Tag schema: same approach as analyze-courier — enum only if tags exist
    const intentsSchema: Record<string, unknown> = { type: "array", items: { type: "string" } };
    if (tagNames.length > 0) {
      intentsSchema.items = { type: "string", enum: tagNames };
    }

    const tools = [
      {
        type: "function",
        function: {
          name: "extract_info",
          description: "Extrait les informations structurées du courrier",
          parameters: {
            type: "object",
            properties: {
              sender_first_name: { type: "string", description: "Prénom de l'expéditeur (chaîne vide si absent)" },
              sender_last_name: { type: "string", description: "Nom de l'expéditeur (chaîne vide si absent)" },
              sender_email: { type: "string", description: "Email de l'expéditeur (chaîne vide si absent)" },
              sender_phone: { type: "string", description: "Téléphone de l'expéditeur (chaîne vide si absent)" },
              recipient_name: { type: "string", description: "Nom du destinataire (chaîne vide si absent)" },
              suggested_service_name: { type: "string", description: "Service le plus pertinent parmi ceux disponibles (chaîne vide si aucun)" },
              suggested_tag_names: intentsSchema,
            },
            required: [
              "sender_first_name",
              "sender_last_name",
              "sender_email",
              "sender_phone",
              "recipient_name",
              "suggested_service_name",
              "suggested_tag_names",
            ],
            additionalProperties: false,
          },
        },
      },
    ];

    // Use same Mistral agent as analyze-courier for consistent results
    const extracted: ExtractedInfo = await withAiUsageGuard({
      admin,
      organizationId: orgId,
      provider: "mistral",
      resourceType: "agent",
      estimatedTokens: estimateTextTokens(systemPrompt.length + userPrompt.length, 800),
      userId: user.id,
      run: async () => {
        const agentResp = await fetch(MISTRAL_AGENT_URL, {
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
            tool_choice: { type: "function", function: { name: "extract_info" } },
          }),
        });

        if (!agentResp.ok) {
          const t = await agentResp.text();
          throw new Error(`Mistral agent ${agentResp.status}: ${t.slice(0, 200)}`);
        }

        const agentData = await agentResp.json();
        const toolCall = agentData?.choices?.[0]?.message?.tool_calls?.[0];
        if (!toolCall?.function?.arguments) throw new Error("Réponse Mistral inattendue");

        const result: ExtractedInfo = JSON.parse(toolCall.function.arguments);
        const actualTokens = agentData?.usage?.total_tokens ?? null;
        return { result, actualTokens };
      },
    });

    // Validate and sanitize against org data (same pattern as analyze-courier)
    const validServiceNames = new Set(serviceNames.map((n) => n.toLowerCase()));
    const suggestedService =
      extracted.suggested_service_name &&
      validServiceNames.has(extracted.suggested_service_name.toLowerCase())
        ? extracted.suggested_service_name
        : null;

    const allowed = new Set(tagNames.map((n) => n.toLowerCase()));
    const suggestedTags = (extracted.suggested_tag_names ?? []).filter(
      (t: string) => typeof t === "string" && allowed.has(t.toLowerCase()),
    );

    // Normalize empty strings to null for string fields
    const nullIfEmpty = (v: string | null | undefined) => (v?.trim() || null);

    // Match sender against usagers (email first, then last_name)
    let matchedUsager = null;
    const senderEmail = nullIfEmpty(extracted.sender_email as unknown as string);
    const senderLastName = nullIfEmpty(extracted.sender_last_name as unknown as string);

    if (senderEmail || senderLastName) {
      if (senderEmail) {
        const { data } = await admin
          .from("usagers")
          .select("id, first_name, last_name, email, phone, category, civilite")
          .eq("organization_id", orgId)
          .ilike("email", senderEmail)
          .limit(1)
          .maybeSingle();
        if (data) matchedUsager = data;
      }

      if (!matchedUsager && senderLastName) {
        const { data } = await admin
          .from("usagers")
          .select("id, first_name, last_name, email, phone, category, civilite")
          .eq("organization_id", orgId)
          .ilike("last_name", senderLastName)
          .limit(1)
          .maybeSingle();
        if (data) matchedUsager = data;
      }
    }

    return jsonResponse({
      sender: {
        first_name: nullIfEmpty(extracted.sender_first_name as unknown as string),
        last_name: senderLastName,
        email: senderEmail,
        phone: nullIfEmpty(extracted.sender_phone as unknown as string),
      },
      recipient_name: nullIfEmpty(extracted.recipient_name as unknown as string),
      suggested_service_name: suggestedService,
      suggested_tag_names: suggestedTags,
      matched_usager: matchedUsager,
      extracted_text: extractedText.slice(0, 10_000),
      // true si certains fichiers du lot n'ont pas pu être OCRisés faute de quota
      // (mais l'extraction a quand même pu se faire sur les fichiers déjà traités).
      quota_exceeded: quotaExceeded,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    const status =
      message === "Unauthorized" ? 401
      : message.startsWith("Forbidden") ? 403
      : err instanceof AiQuotaExceededError ? 429
      : 500;
    return jsonResponse({ error: message }, status);
  }
});
