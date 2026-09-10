import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import {
  AGENT_EXTRACTION,
  AiQuotaExceededError,
  FEATURE_EXTRACTION,
  fitMessage,
  isAiConfigured,
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
  validateAgainstNames,
  cleanSenderFields,
} from "../_shared/courierFieldSuggestions.ts";
import { contactsApiKeyForOrg, fetchContactsApi } from "../_shared/socleContactsClient.ts";
import { assertEditor } from "../_shared/authz.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-org-id",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const BUCKET = "clara-documents";
/** Durée de vie du lien remis au guichet : le temps de l'appel, pas plus. */
const SIGNED_URL_TTL_SECONDS = 300;

interface FileInput {
  name: string;
  mime_type: string;
  content_base64: string;
}

interface ExtractedInfo {
  suggested_subject: string | null;
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

/**
 * Le texte d'un fichier téléversé.
 *
 * ⚠️ LES IMAGES PASSENT DÉSORMAIS PAR LE STOCKAGE, comme les PDF, et ce n'est
 * pas un détour gratuit. Clara envoyait auparavant l'image au fournisseur sous
 * forme de `data:` URI — quelques mégaoctets encodés dans le corps de la
 * requête. Le guichet du Socle n'accepte qu'une URL **https signée** : il ne
 * télécharge pas le document, il transmet le lien au fournisseur, qui va le
 * chercher. C'est ce qui fait que l'octet du document ne traverse jamais le
 * Socle — une garantie qu'un `data:` URI détruirait. Les deux branches se
 * rejoignent donc, et le fichier temporaire est supprimé dans tous les cas.
 */
async function ocrFile(
  admin: ReturnType<typeof getAdminClient>,
  orgId: string,
  file: FileInput,
  ctx: SocleAiContext,
): Promise<string> {
  const mime = file.mime_type.toLowerCase();
  const name = file.name.toLowerCase();

  // Du texte est du texte : ni IA, ni crédit.
  if (mime.startsWith("text/")) {
    return atob(file.content_base64);
  }

  const isImage = mime.startsWith("image/");
  const isPdf = mime === "application/pdf" || name.endsWith(".pdf");
  if (!isImage && !isPdf) return "";

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
      .createSignedUrl(tempKey, SIGNED_URL_TTL_SECONDS);
    if (signErr || !signed) throw new Error(`Signed URL error: ${signErr?.message}`);

    const { text } = await socleOcr({
      ctx,
      documentType: isImage ? "image_url" : "document_url",
      url: signed.signedUrl,
    });
    return text;
  } finally {
    // Le lien signé meurt avec le fichier : la fenêtre d'accès se referme même
    // si l'appel a échoué.
    await admin.storage.from(BUCKET).remove([tempKey]);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const user = await verifyAuth(req);
    const admin = getAdminClient();
    const orgId = req.headers.get("x-org-id");
    if (!orgId) return jsonResponse({ error: "Missing x-org-id header" }, 400);

    await verifyOrgMembership(admin, user.id, orgId);

    // Le consultant est en lecture seule : pas d'extraction IA de courrier.
    if (!(await assertEditor(admin, user.id, orgId))) {
      throw new Error("Forbidden: Accès refusé : rôle consultant en lecture seule");
    }

    const { files, pasted_text } = (await req.json()) as { files?: FileInput[]; pasted_text?: string };
    if (!files?.length && !pasted_text?.trim()) {
      return jsonResponse({ error: "No content provided" }, 400);
    }

    // ⚠️ APRÈS LA VALIDATION DU CORPS, et l'ordre est une décision : une requête
    // malformée est malformée, que l'instance soit raccordée au guichet IA ou
    // non. La renvoyer en 503 ferait chercher une panne de configuration là où
    // il n'y a qu'un appel mal formé.
    //
    // Ce n'est PAS la clé d'un fournisseur — Clara n'en a plus. C'est le
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
    const aiContext: SocleAiContext = {
      socleOrgId,
      feature: FEATURE_EXTRACTION,
      actorId: user.id,
    };

    // OCR each file (up to first 5 to cap cost)
    const texts: string[] = [];
    let quotaExceeded = false;
    for (const file of (files ?? []).slice(0, 5)) {
      try {
        const text = await ocrFile(admin, orgId, file, aiContext);
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

    // Texte collé directement par l'utilisateur — ne passe ni par l'OCR ni par
    // le quota OCR (uniquement par l'appel LLM d'extraction ci-dessous).
    if (pasted_text?.trim()) {
      texts.push(pasted_text.trim().slice(0, 50_000));
    }

    if (!texts.length) return jsonResponse({ error: "Aucun texte extrait des documents" }, 400);

    const extractedText = texts.join("\n\n===\n\n");
    const combinedText = extractedText.slice(0, 30_000);

    // Load org context for the LLM — organisations (miroir Socle), fallback services legacy
    const [{ data: socleOrgRows }, { data: orgTags }] = await Promise.all([
      admin
        .from("socle_organizations")
        .select("name")
        .eq("organization_id", orgId)
        .eq("status", "active")
        .is("obsoleted_at", null),
      admin.from("courier_tags").select("name, tag_group").eq("organization_id", orgId),
    ]);

    let serviceNames: string[] = (socleOrgRows ?? []).map((s: { name: string }) => s.name);
    if (serviceNames.length === 0) {
      const { data: orgServices } = await admin
        .from("services")
        .select("name")
        .eq("organization_id", orgId);
      serviceNames = (orgServices ?? []).map((s: { name: string }) => s.name);
    }
    // Deux groupes, deux listes dans le prompt : le thème dit de quoi parle le
    // courrier, le sentiment sur quel ton. La sortie, elle, reste UNE liste de
    // noms — le groupe est une propriété du tag, pas de son application.
    const tagRows = (orgTags ?? []) as Array<{ name: string; tag_group: string }>;
    const namesOfGroup = (group: string) =>
      tagRows.filter((t) => (t.tag_group ?? "theme") === group).map((t) => t.name);
    const themeTagNames = namesOfGroup("theme");
    const sentimentTagNames = namesOfGroup("sentiment");
    const tagNames: string[] = [...themeTagNames, ...sentimentTagNames];

    const listForPrompt = (names: string[], empty: string) =>
      names.length > 0 ? names.map((n) => `- ${n}`).join("\n") : empty;

    // Le schéma de sortie — celui-là même qui vivait dans `tools` avant la
    // centralisation. Il n'a pas disparu, il a changé de place : le guichet du
    // Socle refuse `tools`/`tool_choice`, et n'offre que la contrainte « du
    // JSON valide ». La conformité au schéma reste donc de la responsabilité
    // de Clara — c'est ce que fait la revalidation, quelques lignes plus bas.
    const tagsSchema: Record<string, unknown> = tagNames.length > 0
      ? { type: "array", items: { type: "string", enum: tagNames } }
      : { type: "array", items: { type: "string" } };

    const responseSchema = objectSchema(
      { ...SUGGESTED_FIELDS_PROPERTIES, suggested_tag_names: tagsSchema },
      [...SUGGESTED_FIELDS_KEYS, "suggested_tag_names"],
    );

    const systemPrompt = `Tu es un assistant expert en gestion de courrier administratif français.
Analyse le texte extrait d'un courrier et restitue les informations structurées.
Règles :
- Ne retourne QUE ce qui est clairement identifiable dans le texte. Ne devine rien.
${SUGGESTED_FIELDS_PROMPT_RULES}
- suggested_tag_names : choisis EXCLUSIVEMENT dans les deux listes ci-dessous (copie exacte du nom, sensible à la casse). N'invente AUCUN tag. Retiens les thèmes qui qualifient le sujet, et AU PLUS UN sentiment pour le ton du rédacteur. Liste vide si rien ne correspond.

Services disponibles : ${serviceNames.length ? serviceNames.join(", ") : "(aucun)"}

Thèmes disponibles (sujet du courrier) :
${listForPrompt(themeTagNames, "(aucun thème défini)")}

Sentiments disponibles (ton du rédacteur) :
${listForPrompt(sentimentTagNames, "(aucun sentiment défini)")}

${jsonSchemaInstruction(responseSchema)}`;

    const userPrompt = `Texte extrait du courrier :
${combinedText}`;

    const answer = await socleCompletion({
      system: systemPrompt,
      messages: [{ role: "user", content: fitMessage(userPrompt) }],
      agent: AGENT_EXTRACTION,
      // ⚠️ LE PLAFOND DE SORTIE, ET NON UNE ESTIMATION SERRÉE : une réponse
      // JSON tronquée ne parse pas et fait perdre tout l'appel, alors qu'une
      // réservation trop haute est rendue au règlement (le Socle solde sur la
      // consommation réelle). Les deux risques ne sont pas du même ordre.
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      json: true,
      ctx: aiContext,
    });
    const extracted = parseJsonAnswer<ExtractedInfo>(answer);

    // Validate and sanitize against org data (same pattern as analyze-courier)
    const suggestedService = validateAgainstNames(extracted.suggested_service_name, serviceNames);

    const allowed = new Set(tagNames.map((n) => n.toLowerCase()));
    const suggestedTags = (extracted.suggested_tag_names ?? []).filter(
      (t: string) => typeof t === "string" && allowed.has(t.toLowerCase()),
    );

    const sender = cleanSenderFields(extracted);
    const senderEmail = sender.email;
    const senderLastName = sender.last_name;

    // Rapprochement de l'expéditeur avec un contact du référentiel Socle
    // (email exact d'abord, puis nom dans display_name). Best-effort : un Socle
    // indisponible ne fait pas échouer l'extraction.
    let matchedContact: unknown = null;

    if (senderEmail || senderLastName) {
      try {
        // `socleOrgId` est déjà résolu plus haut pour l'imputation IA : le
        // relire ici ferait une requête pour rien, et laisserait deux sources
        // pour un même rattachement.
        const contactsKey = contactsApiKeyForOrg(socleOrgId);
        if (contactsKey) {
          if (senderEmail) {
            const { body } = await fetchContactsApi(contactsKey, {
              method: "GET",
              path: `/v1/contacts?email=${encodeURIComponent(senderEmail)}&limit=1`,
              idempotent: true,
            }, { socleOrgId });
            if (Array.isArray(body) && body.length > 0) matchedContact = body[0];
          }
          if (!matchedContact && senderLastName) {
            const { body } = await fetchContactsApi(contactsKey, {
              method: "GET",
              path: `/v1/contacts?search=${encodeURIComponent(senderLastName)}&limit=1`,
              idempotent: true,
            }, { socleOrgId });
            if (Array.isArray(body) && body.length > 0) matchedContact = body[0];
          }
        }
      } catch (e) {
        console.warn("extract-courier-info: rapprochement contact Socle impossible:", e);
      }
    }

    return jsonResponse({
      suggested_subject: nullIfEmpty(extracted.suggested_subject),
      sender,
      recipient_name: nullIfEmpty(extracted.recipient_name),
      suggested_service_name: suggestedService,
      suggested_tag_names: suggestedTags,
      matched_contact: matchedContact,
      extracted_text: extractedText.slice(0, 10_000),
      // true si certains fichiers du lot n'ont pas pu être OCRisés faute de quota
      // (mais l'extraction a quand même pu se faire sur les fichiers déjà traités).
      quota_exceeded: quotaExceeded,
    });
  } catch (err) {
    // Les refus du guichet arrivent déjà traduits, avec leur statut : plafond
    // de la collectivité atteint (message du Socle mot pour mot, date de
    // renouvellement comprise), cadence dépassée, fournisseur muet.
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
