// Proposition du service instructeur (organisation gestionnaire) par l'IA.
//
// Partagé par `analyze-courier` (analyse d'un courrier enregistré) et
// `extract-courier-info` (pré-saisie avant création). Logique pure, sans import
// Deno : testée dans `src/test/socle/service-suggestion-logic.test.ts`.
//
// Le modèle reçoit un CATALOGUE décrit — pas une liste de noms nus : pour
// chaque organisation, ce qu'elle dit faire au public (« informations usager »
// du Socle, `socle_organizations.public_description`) et les démarches qu'elle
// instruit (`procedure_organizations`). Un service interne n'a pas de
// descriptif au Socle : son nom, sa place dans l'arbre et ses démarches sont
// alors tout ce que le modèle sait de lui.
//
// Il répond par IDENTIFIANT, revalidé ici : un id inventé ou hors catalogue ne
// passe pas.

export interface ServiceCandidate {
  id: string;
  name: string;
  socle_id: string;
  socle_parent_id: string | null;
  public_description: string | null;
  workflow_id: string | null;
}

export interface ServiceSuggestion {
  id: string;
  name: string;
  reason: string | null;
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

/** Budget du catalogue dans le prompt, tous services confondus. */
export const SERVICE_CATALOG_MAX_CHARS = 8000;
const MAX_PROCEDURES_PER_SERVICE = 10;

function cut(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/**
 * Une ligne par organisation :
 * `- [id] Nom (rattachée à Parent) — descriptif — démarches instruites : A, B`.
 *
 * Au-delà du budget, les descriptifs raccourcissent, puis disparaissent : le nom
 * et les démarches restent, c'est le minimum pour choisir.
 */
export function buildServiceCatalog(
  candidates: ServiceCandidate[],
  proceduresByOrgId: Map<string, string[]>,
  allOrgs: ServiceCandidate[] = candidates,
  maxChars = SERVICE_CATALOG_MAX_CHARS,
): string {
  if (candidates.length === 0) return "(aucune organisation)";
  const nameBySocleId = new Map(allOrgs.map((o) => [o.socle_id, o.name]));

  const render = (descriptionMax: number) =>
    candidates
      .map((o) => {
        const parts = [`- [${o.id}] ${o.name}`];
        const parent = o.socle_parent_id ? nameBySocleId.get(o.socle_parent_id) : undefined;
        if (parent) parts[0] += ` (rattachée à ${parent})`;
        if (descriptionMax > 0 && o.public_description?.trim()) {
          parts.push(cut(o.public_description.trim(), descriptionMax));
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

  for (const descriptionMax of [400, 150, 0]) {
    const catalog = render(descriptionMax);
    if (catalog.length <= maxChars) return catalog;
  }
  return cut(render(0), maxChars);
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
    },
    required: ["socle_organization_id", "reason"],
    additionalProperties: false,
  },
} as const;

/** Consignes du prompt, avec l'organisation déjà désignée s'il y en a une. */
export function serviceSuggestionPromptRules(current: { id: string; name: string } | null): string {
  const base = `- suggested_service : l'organisation qui devrait INSTRUIRE ce courrier, choisie EXCLUSIVEMENT dans le catalogue des organisations ci-dessous (copie l'identifiant exact indiqué entre crochets). Fonde-toi sur ce que chacune déclare faire et sur les démarches qu'elle instruit, rapprochés du sujet du courrier — pas sur une ressemblance de nom. reason : une phrase factuelle qui cite ce qui, dans le courrier, relève de ses attributions. Si aucune ne s'impose, socle_organization_id = null.`;
  if (!current) return base;
  return `${base}
  Le courrier est DÉJÀ confié à « ${current.name} » [${current.id}]. Reprends cet identifiant s'il convient. N'en propose un autre que si le contenu relève clairement des attributions d'une autre organisation du catalogue — un doute ne justifie pas un transfert.`;
}

const REASON_MAX_CHARS = 300;

/**
 * Réponse du modèle → proposition revalidée, ou `null`. Tolère un nom à la place
 * de l'identifiant (le modèle recopie parfois le libellé), jamais une
 * organisation absente du catalogue.
 */
export function resolveSuggestedService(
  raw: unknown,
  candidates: ServiceCandidate[],
): ServiceSuggestion | null {
  if (!raw || typeof raw !== "object") return null;
  const { socle_organization_id: rawId, reason: rawReason } = raw as Record<string, unknown>;
  if (typeof rawId !== "string" || !rawId.trim()) return null;
  const key = rawId.trim().replace(/^\[|\]$/g, "");
  const lower = key.toLowerCase();
  const match =
    candidates.find((c) => c.id === key) ?? candidates.find((c) => c.name.toLowerCase() === lower);
  if (!match) return null;
  const reason = typeof rawReason === "string" && rawReason.trim() ? cut(rawReason.trim(), REASON_MAX_CHARS) : null;
  return { id: match.id, name: match.name, reason };
}
