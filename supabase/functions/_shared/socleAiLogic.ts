/**
 * Le guichet IA du Socle — LA PART PURE : le contrat, la traduction des refus,
 * et la lecture du JSON rendu.
 *
 * ⚠️ AUCUNE DÉPENDANCE DENO ICI, et c'est la raison d'être du fichier. Jumeau
 * de `socleContactsLogic.ts` : la logique qui mérite des tests vit dans un
 * module que Vitest peut importer depuis `src/`, tandis que le transport et la
 * lecture de l'environnement restent dans `socleAi.ts`. Y introduire un
 * `Deno.env` ou un `fetch` casserait d'un coup la suite de tests du frontend,
 * sans rapport apparent avec le changement.
 *
 * ⚠️ CLARA N'A PLUS DE CLÉ DE FOURNISSEUR. Depuis le 2026-08-29, la clé et la
 * comptabilité des jetons vivent dans le Socle (edge function `ai-api`). Clara
 * compose ses prompts et les confie au guichet, qui réserve, appelle et solde.
 * Un `fetch("https://api.mistral.ai/…")` quelque part dans ce dépôt serait une
 * régression : il rouvrirait un second compteur, et le total par collectivité
 * que la centralisation existe pour produire redeviendrait faux — sans que
 * rien n'échoue visiblement.
 *
 * LA FRONTIÈRE TOMBE OÙ IL FAUT : CLARA DÉCIDE CE QUI EST DIT, LE SOCLE DÉCIDE
 * CE QUE ÇA COÛTE. Clara garde ses prompts, ses schémas et sa validation
 * métier ; elle perd le modèle, l'identifiant d'agent, le compteur et le
 * plafond — que le Socle refuserait d'ailleurs dans le corps de la requête.
 */

// ===========================================================================
// Le contrat
// ===========================================================================

/**
 * Libellé d'imputation de Clara dans le journal du Socle. Purement déclaratif :
 * l'imputation RÉELLE vient de la clé API (`api_keys.consumer`), et le Socle
 * refuse `consumer` dans le corps de la requête.
 */
export const FEATURE_ANALYSIS = "analyse-courrier";
export const FEATURE_PREFILL = "preremplissage-demarche";
export const FEATURE_EXTRACTION = "extraction-courrier";
export const FEATURE_DRAFT = "redaction-reponse";

/**
 * Alias d'agents. Clara demande « extraction-courrier », le Socle sait quel
 * agent c'est et peut en changer (nouveau modèle, nouveau ton) sans que Clara
 * bouge. Un alias inconnu ne provoque JAMAIS de refus : le Socle retombe
 * silencieusement sur son modèle par défaut — d'où la règle, côté Clara, que
 * chaque prompt système soit autosuffisant.
 *
 * ⚠️ Les identifiants d'agent Mistral codés en dur qui vivaient ici
 * (`ag_019d9b92d…`) ont disparu le 2026-08-29 : le Socle les refuse
 * explicitement, et c'est bien — un identifiant d'agent est une décision de
 * coût, elle ne se prend pas chez le consommateur.
 */
export const AGENT_EXTRACTION = "extraction-courrier";
export const AGENT_REDACTION = "redaction-reponse";

/**
 * ⚠️ BORNES DU GUICHET, RECOPIÉES ICI POUR ÊTRE RESPECTÉES AVANT L'APPEL et
 * non découvertes en `400`. Elles appartiennent au Socle (`_shared/tokens.ts`
 * et `_shared/validation.ts` de `ai-api`) ; ce sont des JUMEAUX DOUX — une
 * dérive fait tronquer un peu plus tôt ou un peu plus tard, jamais échouer un
 * appel, parce que la valeur qui décide est celle du Socle.
 */
export const MAX_MESSAGE_CHARS = 40_000;
export const MAX_OUTPUT_TOKENS = 2_000;
/** Pages annoncées au-delà desquelles le guichet refuse (`payload_too_large`). */
export const MAX_OCR_PAGES = 100;

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface SocleAiContext {
  /** Organisation Socle (racine ou non) au nom de laquelle la dépense est faite. */
  socleOrgId: string;
  /** Libellé déclaratif de la fonctionnalité, pour le détail du journal. */
  feature: string;
  /** Référence OPAQUE vers l'objet de Clara — sans signification pour le Socle. */
  reference?: { kind: string; id: string } | null;
  /** Agent Clara à l'origine de l'appel. NULL pour un appel système (cron). */
  actorId?: string | null;
}

// ===========================================================================
// Erreurs
// ===========================================================================

/**
 * Un refus du guichet, déjà retraduit pour Clara.
 *
 * DEUX RÈGLES GOUVERNENT LA TRADUCTION (`mapSocleAiFailure`) :
 *
 *  1. **Une erreur d'authentification n'est jamais relayée.** Un 401/403 du
 *     Socle dit que la clé de Clara est mauvaise, révoquée, sans le scope
 *     « ai » ou sans application imputable : c'est une panne de configuration,
 *     pas un problème de l'agent qui a cliqué. Il reçoit « signaler à un
 *     administrateur », pas le détail — et surtout pas un 401, qui le
 *     déconnecterait.
 *  2. **Un 400 du Socle est NOTRE bug.** Clara compose le payload : si le Socle
 *     le refuse, c'est Clara qui a mal composé. L'agent reçoit une erreur
 *     interne, et la trace part dans les journaux.
 */
export class SocleAiError extends Error {
  constructor(
    message: string,
    /** Statut HTTP que Clara doit rendre à son propre appelant. */
    public status: number,
    /** Code applicatif de Clara (pas celui du Socle, sauf quand ils coïncident). */
    public code: string,
  ) {
    super(message);
    this.name = "SocleAiError";
  }
}

/**
 * Le plafond de la COLLECTIVITÉ est atteint — toutes applications confondues.
 *
 * ⚠️ `renewsAt` VIENT DU SOCLE, il n'est jamais recalculé. C'est le jumeau le
 * plus dangereux du chantier : deux calculs de période qui dérivent ne cassent
 * rien de visible, ils font simplement MENTIR la date — et un traitement
 * reporté « au 1ᵉʳ octobre » quand la période du Socle est encore en août
 * dormirait un mois de trop. Le Socle possède la période ; Clara la lit.
 */
export class AiQuotaExceededError extends SocleAiError {
  constructor(message: string, public renewsAt: string | null = null) {
    super(message, 429, "ai_quota_exceeded");
    this.name = "AiQuotaExceededError";
  }
}

/**
 * La cadence, pas le crédit.
 *
 * ⚠️ DISTINCT DU PLAFOND, ET LA DISTINCTION EST UTILE À QUI LA REÇOIT : le
 * budget est intact, c'est le rythme qui ne l'est pas. Les confondre enverrait
 * un utilisateur freiné réclamer un relèvement de plafond dont il dispose déjà
 * — et, côté worker de file, endormirait un mois durant un courrier simplement
 * arrivé dans une rafale.
 */
export class AiRateLimitedError extends SocleAiError {
  constructor(message: string, public retryAfterSeconds: number) {
    super(message, 429, "ai_rate_limited");
    this.name = "AiRateLimitedError";
  }
}

/** Attente par défaut quand le Socle n'a pas joint d'en-tête `Retry-After`. */
const DEFAULT_RETRY_AFTER_SECONDS = 30;

function socleMessage(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const error = (body as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) return null;
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" && message.trim() !== "" ? message : null;
}

function socleCode(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const error = (body as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

/** `quota.renews_at` du refus (`YYYY-MM-DD`), quand le Socle le joint. */
function renewsAtOf(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const quota = (body as { quota?: unknown }).quota;
  if (typeof quota !== "object" || quota === null) return null;
  const renews = (quota as { renews_at?: unknown }).renews_at;
  return typeof renews === "string" && /^\d{4}-\d{2}-\d{2}/.test(renews) ? renews : null;
}

/**
 * `status === null` ⇒ aucune réponse (réseau, délai dépassé) : le Socle est
 * injoignable. C'est le seul cas où l'utilisateur apprend que le problème vient
 * du référentiel — parce que c'est actionnable pour lui : le reste du
 * traitement du courrier n'est pas affecté, il peut continuer.
 */
export function mapSocleAiFailure(
  status: number | null,
  body: unknown,
  retryAfter: string | null,
): SocleAiError {
  if (status === null) {
    return new SocleAiError(
      "L'assistant IA est indisponible : le référentiel ne répond pas. " +
        "Le traitement du courrier n'est pas affecté.",
      502,
      "socle_unreachable",
    );
  }

  if (status === 429) {
    if (socleCode(body) === "ai_rate_limited") {
      const seconds = Number.parseInt(retryAfter ?? "", 10);
      return new AiRateLimitedError(
        socleMessage(body) ??
          "Trop de sollicitations de l'assistant en peu de temps. Réessayez dans quelques secondes.",
        Number.isFinite(seconds) && seconds > 0 ? seconds : DEFAULT_RETRY_AFTER_SECONDS,
      );
    }
    // ⚠️ LA SEULE PHRASE RELAYÉE MOT POUR MOT : elle nomme la date de
    // renouvellement, que seul le Socle connaît. La recomposer ici recréerait
    // le jumeau que la centralisation vient de supprimer.
    return new AiQuotaExceededError(
      socleMessage(body) ??
        "Le plafond d'utilisation de l'IA est atteint pour ce mois pour votre collectivité.",
      renewsAtOf(body),
    );
  }

  if (status === 503) {
    return new SocleAiError(
      "L'assistant IA n'est pas configuré sur la plateforme.",
      503,
      "not_configured",
    );
  }
  if (status === 401 || status === 403) {
    return new SocleAiError(
      "Authentification auprès du Socle en échec — signaler à un administrateur.",
      502,
      "socle_auth_failed",
    );
  }
  if (status === 400 || status === 404) {
    // Notre bug. Le message du Socle part dans les journaux de l'appelant,
    // jamais vers l'utilisateur : il n'y peut rien.
    return new SocleAiError(
      "Erreur interne — l'assistant n'a pas pu être interrogé.",
      500,
      "internal_error",
    );
  }
  // 502 du Socle (fournisseur muet), 500, et tout le reste.
  return new SocleAiError(
    "L'assistant est momentanément indisponible — réessayez dans un instant.",
    502,
    "ai_unavailable",
  );
}

// ===========================================================================
// Configuration — pure : les valeurs entrent, rien n'est lu de l'environnement
// ===========================================================================

/**
 * Base de `ai-api`, dérivée de celle du référentiel — les edge functions d'un
 * même projet Supabase ne diffèrent que par leur dernier segment. Même idiome
 * que `contactsApiBaseUrl()`, et pour la même raison : un seul secret d'URL à
 * poser, pas un par API.
 *
 * Sans configuration, rend la chaîne vide — jamais une URL fantaisiste vers
 * laquelle on partirait appeler quelque chose.
 */
export function deriveAiApiBaseUrl(
  socleApiUrl: string | undefined | null,
  explicitAiUrl?: string | undefined | null,
): string {
  const explicit = (explicitAiUrl ?? "").trim();
  if (explicit !== "") return explicit.replace(/\/+$/, "");
  const base = (socleApiUrl ?? "").trim().replace(/\/+$/, "");
  if (base === "") return "";
  return base.replace(/(public-api|contacts-api)$/, "ai-api");
}

// ===========================================================================
// Le JSON, du côté de Clara
// ===========================================================================

/**
 * Extrait l'objet JSON d'une réponse de modèle.
 *
 * ⚠️ POURQUOI CETTE FONCTION EXISTE. Clara forçait autrefois la structure par
 * le *tool-calling* de Mistral (`tools` + `tool_choice`), que le guichet refuse
 * par principe : un outil est un second chemin d'accès aux données, non
 * audité. Reste `response_format: "json"`, qui garantit un JSON
 * **syntaxiquement valide** — pas conforme à un schéma. La différence est tout
 * l'objet de ce module et de la validation qui suit chez l'appelant :
 *
 *   • le guichet garantit que ça PARSE ;
 *   • Clara garantit que ça VEUT DIRE quelque chose (tags de l'organisation,
 *     identifiants de démarches existants, champs connus du formulaire).
 *
 * Cette seconde garantie n'a JAMAIS été celle du fournisseur, même du temps du
 * tool-calling : un schéma d'outil n'a jamais empêché un modèle d'inventer un
 * `procedure_id` bien formé mais inexistant. Le code de validation de Clara
 * était donc déjà là, et il reste la vraie défense — ne pas le retirer en
 * croyant que le schéma dans le prompt en tient lieu.
 */
export function parseJsonAnswer<T>(answer: string): T {
  const cleaned = answer
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // Repli : isoler le premier objet complet. Sert quand le modèle glisse une
    // phrase avant ou après malgré la contrainte — le seul écart observé.
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1)) as T;
      } catch {
        // On tombe dans l'erreur commune ci-dessous.
      }
    }
    // ⚠️ Une réponse illisible est une panne d'ASSISTANT, pas une erreur
    // interne : le geste utile pour l'utilisateur est de relancer.
    throw new SocleAiError(
      "La réponse de l'assistant n'a pas pu être interprétée — réessayez.",
      502,
      "ai_invalid_json",
    );
  }
}

/**
 * Tronque un contenu pour tenir dans UN message du guichet.
 *
 * ⚠️ LA BORNE EST CELLE DU SOCLE (40 000 caractères par message) et la dépasser
 * vaut un `400`, c'est-à-dire — après traduction — une « erreur interne » pour
 * l'utilisateur. Les anciens plafonds de Clara (30 000 pour le corps, 60 000
 * pour les pièces jointes, dans le MÊME message) la dépassaient : le compactage
 * se fait donc ici, une fois, plutôt que dans chaque appelant.
 */
export function fitMessage(content: string, budget = MAX_MESSAGE_CHARS): string {
  if (content.length <= budget) return content;
  const marker = "\n\n[…contenu tronqué pour tenir dans la limite de l'assistant…]";
  return content.slice(0, Math.max(0, budget - marker.length)) + marker;
}
