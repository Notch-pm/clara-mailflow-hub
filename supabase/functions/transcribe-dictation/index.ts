// transcribe-dictation — la DICTÉE d'un nouveau courrier devient du texte.
//
// Le navigateur enregistre (WAV PCM 16 bits, 16 kHz, mono : `_shared/dictation.ts`),
// cette fonction relaie au guichet IA du Socle (`ai-api` 1.4.0,
// `POST /v1/transcriptions`) et rend `{ text }`. L'écran affiche le texte,
// l'utilisateur le corrige, puis l'extraction habituelle (`extract-courier-info`,
// `source: "dictation"`) remplit le formulaire.
//
// ⚠️ RIEN N'EST GARDÉ NI JOURNALISÉ : ni l'audio, ni le texte. Le Socle ne
// conserve rien non plus.
//
// Garde-fous, dans cet ordre :
//  1. JWT de l'appelant, membre actif de l'organisation `x-org-id`, rôle
//     éditeur (tout sauf `consultant` — l'élu passe) ;
//  2. la voix est OUVERTE pour cette collectivité (`organizations.ai_voice_enabled`,
//     miroir de `assistant.voice_enabled` du Socle, relu ici et non cru de
//     l'écran) — la dépense se paie sur son crédit ;
//  3. l'enregistrement est exactement au format attendu et sous la durée
//     maximale, contrôlés sur l'en-tête WAV avant tout envoi.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import {
  AiQuotaExceededError,
  FEATURE_DICTATION,
  isAiConfigured,
  SocleAiError,
  socleOrgIdFor,
  socleTranscription,
} from "../_shared/socleAi.ts";
import { assertEditor } from "../_shared/authz.ts";
import {
  DICTATION_LANGUAGE,
  isExpectedDictation,
  MAX_DICTATION_BYTES,
  MAX_DICTATION_SECONDS,
  readWav,
} from "../_shared/dictation.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-org-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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

/** Enveloppe multipart tolérée au-delà de l'audio lui-même. */
const MULTIPART_SLACK_BYTES = 64 * 1024;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const user = await verifyAuth(req);
    const admin = getAdminClient();
    const orgId = req.headers.get("x-org-id");
    if (!orgId) return jsonResponse({ error: "Missing x-org-id header" }, 400);

    await verifyOrgMembership(admin, user.id, orgId);
    if (!(await assertEditor(admin, user.id, orgId))) {
      throw new Error("Forbidden: Accès refusé : rôle consultant en lecture seule");
    }

    // La voix est un interrupteur de la collectivité : relu ICI, jamais cru de
    // l'écran — le bouton masqué ne protège rien.
    const { data: org } = await admin
      .from("organizations")
      .select("ai_voice_enabled")
      .eq("id", orgId)
      .single();
    if ((org as { ai_voice_enabled?: boolean } | null)?.ai_voice_enabled !== true) {
      return jsonResponse(
        { error: "La dictée vocale n'est pas ouverte pour cette collectivité.", code: "voice_disabled" },
        403,
      );
    }

    // Taille refusée AVANT de lire le corps : un envoi démesuré ne se charge
    // pas en mémoire pour rien.
    const declared = Number(req.headers.get("content-length") ?? "0");
    if (declared > MAX_DICTATION_BYTES + MULTIPART_SLACK_BYTES) {
      return jsonResponse(
        { error: `Enregistrement trop long (au plus ${MAX_DICTATION_SECONDS / 60} minutes).`, code: "payload_too_large" },
        400,
      );
    }

    let file: File | null = null;
    try {
      const form = await req.formData();
      const value = form.get("file");
      file = value instanceof File ? value : null;
    } catch {
      file = null;
    }
    if (!file) return jsonResponse({ error: "Aucun enregistrement reçu.", code: "bad_request" }, 400);
    if (file.size > MAX_DICTATION_BYTES) {
      return jsonResponse(
        { error: `Enregistrement trop long (au plus ${MAX_DICTATION_SECONDS / 60} minutes).`, code: "payload_too_large" },
        400,
      );
    }

    const audio = new Uint8Array(await file.arrayBuffer());
    const info = readWav(audio);
    if (!isExpectedDictation(info)) {
      return jsonResponse(
        { error: "Enregistrement illisible ou trop long — recommencez la dictée.", code: "bad_request" },
        400,
      );
    }

    // Après la validation du corps, comme `extract-courier-info` : une requête
    // malformée est malformée, que le guichet soit raccordé ou non.
    if (!isAiConfigured()) {
      return jsonResponse({ error: "L'assistant IA n'est pas configuré sur cette instance." }, 503);
    }
    const socleOrgId = await socleOrgIdFor(admin, orgId);
    if (!socleOrgId) {
      return jsonResponse(
        { error: "Organisation non rattachée au référentiel — la consommation IA ne serait imputable à personne." },
        503,
      );
    }

    const text = await socleTranscription({
      ctx: { socleOrgId, feature: FEATURE_DICTATION, actorId: user.id, reference: null },
      audio,
      durationMs: info.seconds * 1000,
      language: DICTATION_LANGUAGE,
    });

    return jsonResponse({ text });
  } catch (err) {
    if (err instanceof SocleAiError) {
      return jsonResponse({
        error: err.message,
        code: err.code,
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
