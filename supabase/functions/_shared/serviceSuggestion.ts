// Proposition du service instructeur (organisation gestionnaire) par l'IA.
//
// Partagé par `analyze-courier` (analyse d'un courrier enregistré) et
// `extract-courier-info` (pré-saisie avant création). Logique pure, sans import
// Deno : testée dans `src/test/socle/service-suggestion-logic.test.ts`.
//
// Le modèle reçoit un CATALOGUE décrit — pas une liste de noms nus : pour
// chaque organisation,
// - ses ATTRIBUTIONS (`socle_organizations.attributions`, Socle ≥ 1.33.0) : texte
//   interne de ce qu'elle traite et ne traite pas, services internes compris —
//   la source la plus fiable, présentée en premier ;
// - ce qu'elle dit faire au public (« informations usager »,
//   `public_description`), en complément ;
// - les démarches qu'elle instruit (`procedure_organizations`).
// Une organisation sans attributions garde la ligne d'avant (descriptif non
// étiqueté). Un service interne sans attributions n'a que son nom, sa place dans
// l'arbre et ses démarches.
//
// ⚠️ Les attributions sont INTERNES : elles ne vont qu'au modèle et aux agents,
// jamais dans un texte destiné à l'usager (brouillon de réponse, portail).
//
// Il répond par IDENTIFIANT, revalidé ici : un id inventé ou hors catalogue ne
// passe pas.

export interface ServiceCandidate {
  id: string;
  name: string;
  socle_id: string;
  socle_parent_id: string | null;
  public_description: string | null;
  /** Attributions internes (ce qu'elle traite / ne traite pas) — absent ou null : rien d'écrit. */
  attributions?: string | null;
  workflow_id: string | null;
}

export interface ServiceSuggestion {
  id: string;
  name: string;
  reason: string | null;
  /** Confiance du modèle, entier 0–100 ; null s'il ne l'a pas donnée. */
  confidence: number | null;
  /** Autres organisations plausibles (ids du catalogue), au plus deux. */
  alternativeIds: string[];
}

/**
 * Organisations proposables : celles qui ont un workflow — sans workflow, un
 * courrier n'a jamais d'état et ne peut être instruit (règle « ni action ni
 * réponse »). Un tenant dont AUCUNE organisation n'a de workflow garde toute la
 * liste : mieux vaut une proposition que rien.
 */
export function selectServiceCandidates(orgs: ServiceCandidate[]): ServiceCandidate[] {
  const withWorkflow = orgs.filter((o) => !!o.workflow_id);
  return withWorkflow.length > 0 ? withWorkflow : orgs;
}

/**
 * Budget du catalogue dans le prompt, tous services confondus. Relevé de 8000 à
 * 16000 avec les attributions (jusqu'à 2000 caractères par organisation).
 */
export const SERVICE_CATALOG_MAX_CHARS = 16000;

/**
 * Paliers de réduction, du plus riche au plus sobre : le descriptif public
 * raccourcit puis disparaît AVANT que les attributions, plus fiables, ne
 * raccourcissent à leur tour.
 */
const CATALOG_STEPS: { attributionsMax: number; descriptionMax: number }[] = [
  { attributionsMax: 2000, descriptionMax: 400 },
  { attributionsMax: 2000, descriptionMax: 150 },
  { attributionsMax: 2000, descriptionMax: 0 },
  { attributionsMax: 800, descriptionMax: 0 },
  { attributionsMax: 400, descriptionMax: 0 },
  { attributionsMax: 200, descriptionMax: 0 },
];
const MAX_PROCEDURES_PER_SERVICE = 10;

function cut(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/**
 * Une ligne par organisation :
 * - avec attributions :
 *   `- [id] Nom (rattachée à Parent) — attributions : … — informations usager : … — démarches instruites : A, B`
 * - sans (comportement d'avant, inchangé) :
 *   `- [id] Nom (rattachée à Parent) — descriptif — démarches instruites : A, B`
 *
 * Au-delà du budget (voir `CATALOG_STEPS`), les descriptifs raccourcissent puis
 * disparaissent, ensuite seulement les attributions raccourcissent : le nom et les
 * démarches restent, c'est le minimum pour choisir.
 */
export function buildServiceCatalog(
  candidates: ServiceCandidate[],
  proceduresByOrgId: Map<string, string[]>,
  allOrgs: ServiceCandidate[] = candidates,
  maxChars = SERVICE_CATALOG_MAX_CHARS,
): string {
  if (candidates.length === 0) return "(aucune organisation)";
  const nameBySocleId = new Map(allOrgs.map((o) => [o.socle_id, o.name]));

  const render = ({ attributionsMax, descriptionMax }: (typeof CATALOG_STEPS)[number]) =>
    candidates
      .map((o) => {
        const parts = [`- [${o.id}] ${o.name}`];
        const parent = o.socle_parent_id ? nameBySocleId.get(o.socle_parent_id) : undefined;
        if (parent) parts[0] += ` (rattachée à ${parent})`;
        const attributions = o.attributions?.trim();
        if (attributions) parts.push(`attributions : ${cut(attributions, attributionsMax)}`);
        if (descriptionMax > 0 && o.public_description?.trim()) {
          const description = cut(o.public_description.trim(), descriptionMax);
          parts.push(attributions ? `informations usager : ${description}` : description);
        }
        const procedures = proceduresByOrgId.get(o.id) ?? [];
        if (procedures.length > 0) {
          const shown = procedures.slice(0, MAX_PROCEDURES_PER_SERVICE);
          const more = procedures.length - shown.length;
          parts.push(`démarches instruites : ${shown.join(", ")}${more > 0 ? ` (+${more})` : ""}`);
        }
        return parts.join(" — ");
      })
      .join("\n");

  for (const step of CATALOG_STEPS) {
    const catalog = render(step);
    if (catalog.length <= maxChars) return catalog;
  }
  return cut(render(CATALOG_STEPS[CATALOG_STEPS.length - 1]), maxChars);
}

/** Propriété du schéma de sortie (via `objectSchema` / `jsonSchemaInstruction`). */
export const SERVICE_SUGGESTION_PROPERTY = {
  suggested_service: {
    type: "object",
    description: "Organisation qui devrait instruire ce courrier",
    properties: {
      socle_organization_id: {
        type: ["string", "null"],
        description: "Identifiant exact d'une organisation du catalogue (entre crochets), ou null",
      },
      reason: {
        type: "string",
        description: "Une phrase : ce qui, dans le courrier, relève de ses attributions",
      },
      confidence: {
        type: "integer",
        description: "Confiance dans ce choix, de 0 à 100",
      },
      alternative_ids: {
        type: "array",
        items: { type: "string" },
        description: "Jusqu'à deux autres identifiants du catalogue plausibles, du plus au moins probable",
      },
    },
    required: ["socle_organization_id", "reason", "confidence", "alternative_ids"],
    additionalProperties: false,
  },
} as const;

/** Consignes du prompt, avec l'organisation déjà désignée s'il y en a une. */
export function serviceSuggestionPromptRules(current: { id: string; name: string } | null): string {
  const base = `- suggested_service : l'organisation qui devrait INSTRUIRE ce courrier, choisie EXCLUSIVEMENT dans le catalogue des organisations ci-dessous (copie l'identifiant exact indiqué entre crochets). Fonde-toi D'ABORD sur les « attributions » quand une organisation en a (ce qu'elle traite ET ce qu'elle ne traite pas : une exclusion explicite l'écarte), puis sur les démarches qu'elle instruit ; les « informations usager » ne viennent qu'en complément. Rapproche-les du sujet du courrier — pas d'une ressemblance de nom. reason : une phrase factuelle qui cite ce qui, dans le courrier, relève de ses attributions. Si aucune ne s'impose, socle_organization_id = null et reason dit en une phrase pourquoi (sujet ambigu, demandes relevant de plusieurs organisations, aucune attribution correspondante…).
  confidence : de 0 à 100, ta confiance que CE service est le bon — 90 et plus seulement si le courrier relève sans ambiguïté de ses attributions (il pourra être routé sans relecture détaillée) ; moins de 70 si deux services sont plausibles, si le courrier mêle plusieurs demandes relevant de services différents ou si le contenu est peu lisible. alternative_ids : jusqu'à deux autres identifiants du catalogue plausibles, liste vide s'il n'y en a pas.`;
  if (!current) return base;
  return `${base}
  Le courrier est DÉJÀ confié à « ${current.name} » [${current.id}]. Reprends cet identifiant s'il convient. N'en propose un autre que si le contenu relève clairement des attributions d'une autre organisation du catalogue — un doute ne justifie pas un transfert.`;
}

const REASON_MAX_CHARS = 300;
const MAX_ALTERNATIVES = 2;

/** Identifiant (ou, à défaut, nom recopié) → candidat du catalogue. */
function findCandidate(raw: unknown, candidates: ServiceCandidate[]): ServiceCandidate | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const key = raw.trim().replace(/^\[|\]$/g, "");
  const lower = key.toLowerCase();
  return candidates.find((c) => c.id === key) ?? candidates.find((c) => c.name.toLowerCase() === lower) ?? null;
}

/** Score borné 0–100, arrondi. Accepte « 85 » comme 0.85 (le modèle confond parfois). */
function toConfidence(raw: unknown): number | null {
  const n = typeof raw === "string" && raw.trim() ? Number(raw.trim()) : raw;
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  const pct = n > 0 && n < 1 ? n * 100 : n;
  return Math.min(100, Math.max(0, Math.round(pct)));
}

/**
 * Réponse du modèle → proposition revalidée, ou `null`. Tolère un nom à la place
 * de l'identifiant (le modèle recopie parfois le libellé), jamais une
 * organisation absente du catalogue — pour la proposition comme pour les
 * alternatives (doublons et proposition elle-même écartés).
 */
export function resolveSuggestedService(
  raw: unknown,
  candidates: ServiceCandidate[],
): ServiceSuggestion | null {
  if (!raw || typeof raw !== "object") return null;
  const {
    socle_organization_id: rawId,
    reason: rawReason,
    confidence: rawConfidence,
    alternative_ids: rawAlternatives,
  } = raw as Record<string, unknown>;
  const match = findCandidate(rawId, candidates);
  if (!match) return null;
  const reason = typeof rawReason === "string" && rawReason.trim() ? cut(rawReason.trim(), REASON_MAX_CHARS) : null;
  const alternativeIds: string[] = [];
  if (Array.isArray(rawAlternatives)) {
    for (const alt of rawAlternatives) {
      if (alternativeIds.length >= MAX_ALTERNATIVES) break;
      const found = findCandidate(alt, candidates);
      if (found && found.id !== match.id && !alternativeIds.includes(found.id)) alternativeIds.push(found.id);
    }
  }
  return { id: match.id, name: match.name, reason, confidence: toConfidence(rawConfidence), alternativeIds };
}

/**
 * Pourquoi aucune organisation n'est proposée — phrase destinée à l'agent qui
 * saisit le courrier (`extract-courier-info`). Se taire laissait croire à une
 * panne : l'agent doit savoir si le courrier est ambigu ou si c'est le
 * référentiel qui ne dit pas assez de choses de ses organisations.
 *
 * Écrit pour l'écran : jamais « Socle », toujours « référentiel ».
 */
export function noServiceSuggestionNote(raw: unknown, candidates: ServiceCandidate[]): string {
  if (candidates.length === 0) return "Aucune organisation n'est disponible dans le référentiel.";
  const fields = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const rawId = fields.socle_organization_id;
  const rawReason = typeof fields.reason === "string" ? fields.reason.trim() : "";
  const why =
    typeof rawId === "string" && rawId.trim()
      ? "L'organisation envisagée par l'IA ne figure pas parmi celles qui instruisent le courrier."
      : rawReason
        ? cut(rawReason, REASON_MAX_CHARS)
        : "Le contenu ne relève clairement d'aucune organisation.";
  const described = candidates.some((c) => c.attributions?.trim());
  return described
    ? why
    : `${why} Les organisations n'ont pas d'attributions renseignées dans le référentiel : l'IA ne connaît que leurs noms et leurs démarches.`;
}
