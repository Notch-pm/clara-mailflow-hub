import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import {
  AiQuotaExceededError,
  FEATURE_EXTRACTION,
  isAiConfigured,
  SocleAiError,
  socleOcr,
  socleOrgIdFor,
  type SocleAiContext,
} from "../_shared/socleAi.ts";
import { analysisRow, runCourierAnalysis } from "../_shared/courierAnalysisCore.ts";
import { contactsApiKeyForOrg, fetchContactsApi } from "../_shared/socleContactsClient.ts";
import { assertEditor } from "../_shared/authz.ts";
import {
  buildSenderMatchPayload,
  noSenderMatch,
  resolveSenderMatch,
  type MatchCandidate,
  type SenderMatch,
} from "../_shared/senderMatchLogic.ts";

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
 * Pièce que l'OCR ne sait pas lire. Ce n'est pas une panne — un .docx joint à
 * un courrier est un cas ordinaire — mais ça se dit : sans ce motif, l'agent
 * ne voit qu'une extraction vide, sans rien à corriger.
 */
class UnsupportedFileError extends Error {}

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
  if (!isImage && !isPdf) {
    throw new UnsupportedFileError(
      `type non pris en charge (${file.mime_type || "type inconnu"}) — seuls les PDF, les images et les fichiers texte sont lus`,
    );
  }

  // Le nom du fichier n'entre PAS tel quel dans une clé de stockage : Storage
  // n'accepte que `\w` et une poignée de signes, si bien qu'un seul accent — le
  // « é » de « Compétences » — faisait échouer l'envoi, donc l'OCR, donc toute
  // l'extraction, sur un nom de fichier pourtant banal en français. Même
  // assainissement qu'à `fetch-inbound-emails` et `portal-form`, qui écrivent
  // depuis toujours des clés sûres.
  const safeName = (file.name || "document").replace(/[^\w.\-]+/g, "_");
  const tempKey = `${orgId}/temp/${crypto.randomUUID()}-${safeName}`;
  const bytes = Uint8Array.from(atob(file.content_base64), (c) => c.charCodeAt(0));

  const { error: upErr } = await admin.storage.from(BUCKET).upload(tempKey, bytes, {
    contentType: file.mime_type,
    upsert: false,
  });
  if (upErr) throw new Error(`préparation du fichier impossible (${upErr.message})`);

  try {
    const { data: signed, error: signErr } = await admin.storage
      .from(BUCKET)
      .createSignedUrl(tempKey, SIGNED_URL_TTL_SECONDS);
    if (signErr || !signed) {
      throw new Error(`lien de lecture impossible à produire (${signErr?.message})`);
    }

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

    const { files, pasted_text, source } = (await req.json()) as {
      files?: FileInput[];
      pasted_text?: string;
      /** `dictation` : le texte collé est la transcription d'une dictée vocale. */
      source?: string;
    };
    const fromDictation = source === "dictation";
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
    // Le traitement reste best-effort — un fichier illisible parmi cinq ne doit
    // pas emporter le lot —, mais chaque échec garde son motif et son nom de
    // fichier : c'est tout ce que l'agent a pour comprendre quoi refaire.
    const ocrFailures: string[] = [];
    let quotaExceeded = false;
    for (const file of (files ?? []).slice(0, 5)) {
      try {
        const text = await ocrFile(admin, orgId, file, aiContext);
        if (text.trim()) texts.push(text.trim());
        else ocrFailures.push(`« ${file.name} » : aucun texte lisible dans ce document`);
      } catch (e) {
        if (e instanceof AiQuotaExceededError) {
          // Contrairement aux autres erreurs OCR par fichier (avalées en
          // silence, traitement best-effort), le quota dépassé concerne
          // l'organisation entière : inutile de continuer la boucle, les
          // fichiers suivants échoueraient tous pour la même raison.
          quotaExceeded = true;
          break;
        }
        const reason = e instanceof Error ? e.message : String(e);
        ocrFailures.push(`« ${file.name} » : ${reason}`);
        console.error(`OCR failed for ${file.name}:`, reason);
      }
    }

    if (quotaExceeded && !texts.length) {
      return jsonResponse({ error: "quota_exceeded" }, 429);
    }

    // Texte des pièces seules : le texte collé est passé à part à l'analyse.
    const ocrTexts = [...texts];

    // Texte collé directement par l'utilisateur — ne passe ni par l'OCR ni par
    // le quota OCR (uniquement par l'appel d'analyse ci-dessous).
    if (pasted_text?.trim()) {
      texts.push(pasted_text.trim().slice(0, 50_000));
    }

    if (!texts.length) {
      return jsonResponse(
        {
          error: ocrFailures.length
            ? `Aucun texte n'a pu être extrait — ${ocrFailures.join(" ; ")}`
            : "Aucun texte n'a pu être extrait des documents fournis.",
          ocr_failures: ocrFailures,
        },
        400,
      );
    }

    const extractedText = texts.join("\n\n===\n\n");

    // L'analyse COMPLÈTE, la même que celle d'un courrier existant : résumé,
    // classement, actions suggérées (avec préremplissage des démarches),
    // titre, expéditeur, organisation proposée. L'écran l'enregistre telle
    // quelle sur le courrier à sa création — plus de seconde analyse.
    const analysis = await runCourierAnalysis(
      admin,
      orgId,
      {
        subject: null,
        // Texte collé ou dicté : le « corps » ; pièces : leur texte extrait.
        body: pasted_text?.trim() ? pasted_text.trim().slice(0, 50_000) : "",
        attachmentsText: ocrTexts.join("\n\n===\n\n"),
        fromDictation,
      },
      { ctx: aiContext },
    );
    const sender = analysis.sender;

    // Rapprochement de l'expéditeur avec le référentiel Socle : le Socle compare
    // email, téléphone et nom+prénom (`POST /v1/contacts/match`), la règle de
    // décision est celle de `senderMatchLogic` — commune avec l'import en masse.
    // Best-effort : un Socle indisponible ne fait pas échouer l'extraction,
    // mais rend `null` (« non vérifié ») et non « aucun contact » — ce qui
    // ferait créer un doublon ; l'écran refait alors le rapprochement.
    const matchPayload = buildSenderMatchPayload(sender);
    let senderMatch: SenderMatch | null = matchPayload ? null : noSenderMatch();

    if (matchPayload) {
      try {
        // `socleOrgId` est déjà résolu plus haut pour l'imputation IA : le
        // relire ici ferait une requête pour rien, et laisserait deux sources
        // pour un même rattachement.
        const contactsKey = contactsApiKeyForOrg(socleOrgId);
        if (contactsKey) {
          const { body } = await fetchContactsApi(contactsKey, {
            method: "POST",
            path: "/v1/contacts/match",
            body: matchPayload,
            // Lecture seule malgré le POST : rejouable sans risque.
            idempotent: true,
          }, { socleOrgId });
          senderMatch = resolveSenderMatch(sender, body as MatchCandidate[]);
        }
      } catch (e) {
        console.warn("extract-courier-info: rapprochement contact Socle impossible:", e);
      }
    }

    const service = analysis.service;
    return jsonResponse({
      suggested_subject: analysis.suggested_subject,
      sender,
      recipient_name: analysis.suggested_recipient_name,
      suggested_service_name: service?.name ?? null,
      suggested_socle_organization_id: service?.id ?? null,
      suggested_service_reason: service?.reason ?? null,
      suggested_service_confidence: service?.confidence ?? null,
      service_suggestion_note: analysis.service_note,
      // Classement : thèmes et sentiment, tags de l'organisation revalidés.
      suggested_tag_names: analysis.intents,
      summary: analysis.summary,
      suggested_actions: analysis.suggested_actions,
      // La ligne `courier_analyses` prête à écrire : l'écran l'enregistre sur
      // le courrier qu'il crée, sans relancer d'analyse.
      analysis: analysisRow(analysis),
      // Compat : rempli seulement quand le contact est sélectionné d'office.
      matched_contact: senderMatch?.status === "matched" ? senderMatch.contact : null,
      sender_match: senderMatch,
      extracted_text: extractedText.slice(0, 10_000),
      // true si certains fichiers du lot n'ont pas pu être OCRisés faute de quota
      // (mais l'extraction a quand même pu se faire sur les fichiers déjà traités).
      quota_exceeded: quotaExceeded,
      // Échecs partiels : l'extraction a abouti, mais pas sur tout le lot. Le
      // détail remonte à l'écran plutôt que de rester dans le journal.
      ocr_failures: ocrFailures,
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
