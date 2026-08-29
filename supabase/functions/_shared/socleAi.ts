/**
 * Le guichet IA du Socle, vu de Clara — LE SEUL CHEMIN VERS UN FOURNISSEUR IA.
 *
 * Le transport et la lecture de l'environnement vivent ici ; le contrat, la
 * traduction des refus et la lecture du JSON sont dans `socleAiLogic.ts`, pur
 * et testé depuis `src/test/socle/socle-ai.test.ts`. Ce module ré-exporte le
 * tout : les edge functions n'ont qu'un import à écrire.
 *
 * ⚠️ CLARA N'A PLUS DE CLÉ DE FOURNISSEUR. Depuis le 2026-08-29, la clé et la
 * comptabilité des jetons vivent dans le Socle (edge function `ai-api`). Si
 * vous lisez un `fetch("https://api.mistral.ai/…")` quelque part dans ce dépôt,
 * c'est une régression : il rouvrirait un second compteur, et le total par
 * collectivité que la centralisation existe pour produire redeviendrait faux.
 *
 * ⚠️ CHAÎNE DE DÉLAIS, À NE PAS INVERSER : Mistral 55 s < Socle 60 s < Clara
 * 75 s. Inversée, Clara abandonne des appels que le Socle termine et facture —
 * et l'utilisateur, en réessayant, paie deux fois. Il n'existe pas de clé
 * d'idempotence : elle exigerait que le Socle stocke la réponse, ce que sa
 * promesse de passe-plat interdit.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import {
  AiRateLimitedError,
  type ChatMessage,
  deriveAiApiBaseUrl,
  mapSocleAiFailure,
  MAX_OCR_PAGES,
  MAX_OUTPUT_TOKENS,
  SocleAiError,
  type SocleAiContext,
} from "./socleAiLogic.ts";

export {
  AGENT_EXTRACTION,
  AGENT_REDACTION,
  AiQuotaExceededError,
  AiRateLimitedError,
  type ChatMessage,
  deriveAiApiBaseUrl,
  FEATURE_ANALYSIS,
  FEATURE_DRAFT,
  FEATURE_EXTRACTION,
  FEATURE_PREFILL,
  fitMessage,
  mapSocleAiFailure,
  MAX_MESSAGE_CHARS,
  MAX_OCR_PAGES,
  MAX_OUTPUT_TOKENS,
  parseJsonAnswer,
  type SocleAiContext,
  SocleAiError,
} from "./socleAiLogic.ts";

/** Au-dessus des 60 s du Socle — voir la chaîne de délais ci-dessus. */
const TIMEOUT_MS = 75_000;

/** Attente maximale après un refus de cadence, avant de rendre la main. */
const MAX_RATE_LIMIT_WAIT_SECONDS = 20;

// ===========================================================================
// Configuration
// ===========================================================================

export function aiApiBaseUrl(): string {
  return deriveAiApiBaseUrl(
    Deno.env.get("SOCLE_API_URL"),
    Deno.env.get("SOCLE_AI_API_URL"),
  );
}

/**
 * ⚠️ CE N'EST PAS LA CLÉ D'UN FOURNISSEUR — Clara n'en a plus. C'est la clé
 * Socle de Clara, celle qui porte le scope « ai » et l'application imputable.
 */
export function socleAiKey(): string | null {
  return Deno.env.get("SOCLE_API_KEY")?.trim() || null;
}

/** Vrai si le guichet est joignable — à vérifier avant tout travail coûteux. */
export function isAiConfigured(): boolean {
  return aiApiBaseUrl() !== "" && socleAiKey() !== null;
}

/**
 * L'organisation SOCLE d'une organisation Clara : le périmètre de facturation.
 *
 * ⚠️ TOUJOURS DÉRIVÉ CÔTÉ SERVEUR du tenant déjà vérifié, jamais reçu du
 * client — sinon n'importe quel appelant ferait débiter la collectivité de son
 * choix. Le Socle remonte ensuite de lui-même à l'organisation RACINE : un
 * appel émis au nom d'une sous-organisation débite sa collectivité.
 */
export async function socleOrgIdFor(
  admin: SupabaseClient,
  organizationId: string,
): Promise<string | null> {
  const { data } = await admin
    .from("organizations")
    .select("socle_org_id")
    .eq("id", organizationId)
    .single();
  const id = (data as { socle_org_id?: string | null } | null)?.socle_org_id;
  return typeof id === "string" && id.trim() !== "" ? id : null;
}

// ===========================================================================
// L'appel
// ===========================================================================

interface SocleAiRequest {
  path: "/v1/completions" | "/v1/ocr";
  payload: Record<string, unknown>;
  ctx: SocleAiContext;
}

/**
 * Un appel au guichet, avec UN réessai après un refus de cadence.
 *
 * ⚠️ POURQUOI RÉESSAYER LA CADENCE, ET RIEN D'AUTRE. L'analyse d'un courrier
 * lance une rafale (un OCR par pièce jointe, l'analyse, puis un préremplissage
 * par démarche) : le garde-fou de débit du Socle est fait pour couper les
 * boucles, pas ce travail-là, et il compte par agent. Attendre le
 * `Retry-After` puis reprendre est donc le comportement juste.
 *
 * Réessayer un refus de PLAFOND serait au contraire absurde — il n'y a rien à
 * attendre avant le renouvellement. Et réessayer une panne de fournisseur
 * risquerait de payer deux fois un appel que le Socle a peut-être terminé,
 * puisqu'il n'existe pas de clé d'idempotence.
 */
async function callSocleAi(
  { path, payload, ctx }: SocleAiRequest,
  attempt = 0,
): Promise<unknown> {
  const base = aiApiBaseUrl();
  const key = socleAiKey();
  if (base === "" || !key) {
    throw new SocleAiError(
      "L'assistant IA n'est pas configuré sur cette instance.",
      503,
      "not_configured",
    );
  }

  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "X-Organization-Id": ctx.socleOrgId,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ...payload,
      feature: ctx.feature,
      reference: ctx.reference ?? null,
      actor_id: ctx.actorId ?? null,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch(() => null);

  if (!res) throw mapSocleAiFailure(null, null, null);

  const body = await res.json().catch(() => null);
  if (res.ok) return body;

  const failure = mapSocleAiFailure(res.status, body, res.headers.get("Retry-After"));

  if (failure instanceof AiRateLimitedError && attempt === 0) {
    // Un seul réessai, et une attente BORNÉE : au-delà, la fonction dépasserait
    // le délai de son propre appelant, et l'utilisateur verrait une page qui ne
    // répond pas plutôt qu'un message qui explique.
    const waitMs = Math.min(failure.retryAfterSeconds, MAX_RATE_LIMIT_WAIT_SECONDS) * 1000;
    console.warn(`socleAi: cadence dépassée sur ${path}, reprise dans ${waitMs / 1000} s`);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    return await callSocleAi({ path, payload, ctx }, attempt + 1);
  }

  throw failure;
}

export interface CompletionOptions {
  system: string;
  messages: ChatMessage[];
  ctx: SocleAiContext;
  /** Alias logique, résolu par le Socle. Inconnu ⇒ modèle par défaut. */
  agent?: string | null;
  maxOutputTokens?: number;
  /** `true` ⇒ sortie contrainte en JSON syntaxiquement valide. */
  json?: boolean;
}

/**
 * Une complétion. Rend la réponse du modèle, débarrassée de son enrobage.
 *
 * ⚠️ LE `usage` ET LE `quota` DE LA RÉPONSE NE SONT PAS RELUS : le journal et
 * le compteur du Socle font foi, et une seconde comptabilité côté Clara ne
 * pourrait que diverger. C'est exactement le second compteur que la
 * centralisation a supprimé.
 */
export async function socleCompletion(options: CompletionOptions): Promise<string> {
  const { system, messages, ctx, agent = null, maxOutputTokens, json = false } = options;

  const body = await callSocleAi({
    path: "/v1/completions",
    payload: {
      agent,
      system,
      messages,
      max_output_tokens: Math.min(maxOutputTokens ?? MAX_OUTPUT_TOKENS, MAX_OUTPUT_TOKENS),
      ...(json ? { response_format: "json" } : {}),
    },
    ctx,
  });

  const answer = (body as { answer?: unknown } | null)?.answer;
  if (typeof answer !== "string" || answer.trim() === "") {
    console.error("socleAi: réponse du guichet vide ou inattendue");
    throw new SocleAiError(
      "L'assistant est momentanément indisponible — réessayez dans un instant.",
      502,
      "ai_unavailable",
    );
  }
  return answer.trim();
}

export interface OcrOptions {
  ctx: SocleAiContext;
  /** `document_url` pour un PDF, `image_url` pour une image. */
  documentType: "document_url" | "image_url";
  /**
   * URL **https signée et de courte durée**.
   *
   * ⚠️ C'EST UN DROIT D'ACCÈS QUI CIRCULE : le Socle ne télécharge pas le
   * document, il transmet ce lien au fournisseur qui va le chercher. Émettez-le
   * juste avant l'appel, avec la durée de vie la plus courte possible.
   */
  url: string;
  /** Pages annoncées — sert à RÉSERVER, jamais à facturer. */
  pageCountHint?: number | null;
}

export interface OcrOutcome {
  text: string;
  pageCount: number | null;
}

/**
 * L'OCR d'un document scanné.
 *
 * ⚠️ N'APPELEZ CECI QUE POUR CE QUI L'EXIGE : un PDF avec couche texte, un
 * DOCX, un ODT, un RTF ou un TXT s'extraient dans Clara, sans IA et sans
 * crédit. Le guichet est réservé aux PDF scannés et aux images — c'est-à-dire
 * aux cas où il n'y a rien à extraire autrement. Chaque appel évité est du
 * crédit qui reste à la collectivité pour ce qui compte.
 */
export async function socleOcr(options: OcrOptions): Promise<OcrOutcome> {
  const { ctx, documentType, url, pageCountHint } = options;

  const hint = typeof pageCountHint === "number" && Number.isFinite(pageCountHint)
    ? Math.min(Math.max(Math.ceil(pageCountHint), 1), MAX_OCR_PAGES)
    : 1;

  const body = await callSocleAi({
    path: "/v1/ocr",
    payload: { document: { type: documentType, url }, page_count_hint: hint },
    ctx,
  });

  const text = (body as { text?: unknown } | null)?.text;
  const pageCount = (body as { page_count?: unknown } | null)?.page_count;
  return {
    // Un document sans texte n'est PAS une erreur (page blanche, scan
    // illisible) : l'appelant décide quoi en faire.
    text: typeof text === "string" ? text : "",
    pageCount: typeof pageCount === "number" && pageCount > 0 ? pageCount : null,
  };
}
