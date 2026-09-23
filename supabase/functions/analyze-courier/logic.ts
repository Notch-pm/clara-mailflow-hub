// Logique pure de l'analyse : catalogue de démarches injecté au prompt,
// extraction des champs de formulaire Socle, condensé de base de connaissance,
// schéma dynamique de sortie du préremplissage et sanitisation de cette sortie.
// AUCUN import Deno ici : ce module est importé par index.ts (edge function)
// ET par les tests Vitest (src/test/socle/).
//
// ⚠️ « report_prefill », « report_analysis » et `toolParameters` sont des NOMS
// D'ÉPOQUE : jusqu'au 2026-08-29, ces schémas voyageaient dans le champ `tools`
// de l'API du fournisseur, et le modèle était forcé d'« appeler l'outil ». Le
// guichet du Socle refuse `tools`/`tool_choice` — chaque outil est un second
// chemin d'accès aux données, non audité — et n'offre que `response_format:
// "json"`. Les schémas n'ont donc pas disparu : ils voyagent maintenant DANS LE
// PROMPT (`_shared/jsonSchemaPrompt.ts`). Les noms sont conservés parce qu'ils
// servent d'étiquettes dans les journaux et les tests, mais plus aucun outil
// n'existe. Ce qui n'a pas changé du tout : `sanitizePrefillArguments` reste la
// vraie défense — un schéma d'outil n'a JAMAIS empêché un modèle d'inventer une
// valeur bien formée et fausse.

// ── Catalogue de démarches (appel 1 — l'analyse) ────────────────────────────

export interface ProcedureCatalogEntry {
  id: string;
  name: string;
  external_source: string | null;
  keywords?: unknown;
  agent_description?: string | null;
  description?: string | null;
  /**
   * Organisations qui ASSURENT cette démarche (miroir `procedure_organizations`).
   * Absent ou vide = démarche hors référentiel (Arpège, embryon local) : aucune
   * organisation ne s'impose.
   */
  organizations?: OrganizationRef[];
}

export interface OrganizationRef {
  id: string;
  name: string;
}

/** Coupe au dernier espace avant `max` et ajoute une ellipse. */
export function truncate(text: string, max: number): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut) + "…";
}

function keywordsOf(entry: ProcedureCatalogEntry): string[] {
  if (!Array.isArray(entry.keywords)) return [];
  return entry.keywords.filter((k): k is string => typeof k === "string" && k.trim().length > 0).slice(0, 8);
}

function catalogLine(entry: ProcedureCatalogEntry, descriptionMax: number): string {
  const source = entry.external_source === "arpege" ? " (Arpège)"
    : entry.external_source === "socle" ? " (Socle)" : "";
  const parts = [`- [id: ${entry.id}] ${entry.name}${source}`];
  const kw = keywordsOf(entry);
  if (kw.length > 0) parts.push(`mots-clés: ${kw.join(", ")}`);
  // Le choix d'organisation est CONTRAINT par cette liste : une démarche
  // déposée sur un organisme qui ne l'assure pas est refusée par Iris.
  const orgs = entry.organizations ?? [];
  if (orgs.length > 0) {
    parts.push(`assurée par: ${orgs.map((o) => `${o.name} [org: ${o.id}]`).join(" | ")}`);
  }
  if (descriptionMax > 0) {
    const desc = (entry.agent_description ?? entry.description ?? "").trim();
    if (desc) parts.push(truncate(desc, descriptionMax));
  }
  return parts.join(" — ");
}

/**
 * Bloc « démarches disponibles » du prompt d'analyse. Règle dégressive
 * déterministe pour tenir le budget tokens : descriptions à 220 chars,
 * puis 120 si le bloc dépasse 15 000 chars, puis nom + mots-clés seuls
 * au-delà de 25 000.
 */
export function buildProcedureCatalog(entries: ProcedureCatalogEntry[]): string {
  if (entries.length === 0) return "(aucune démarche définie)";
  for (const descriptionMax of [220, 120, 0]) {
    const block = entries.map((e) => catalogLine(e, descriptionMax)).join("\n");
    if (block.length <= (descriptionMax === 220 ? 15_000 : 25_000) || descriptionMax === 0) {
      return block;
    }
  }
  return entries.map((e) => catalogLine(e, 0)).join("\n"); // inatteignable, pour le typage
}

// ── Champs remplissables d'un form_schema Socle ─────────────────────────────

export interface FillableFieldOption {
  value: string;
  label: string;
}

export interface FillableField {
  id: string;
  /** Clé du contrat de préremplissage : `key` du champ, ou `id` si key vide. */
  prefillKey: string;
  label: string;
  type: string;
  options: FillableFieldOption[];
  help: string | null;
}

const FILLABLE_TYPES = new Set([
  "text", "textarea", "number", "date", "email", "phone",
  "boolean", "select", "radio", "checkboxes",
  // Lieu d'intervention (Socle 1.29.0) : l'IA en rend l'ADRESSE en texte ; le
  // dialogue en fait un lieu sans point (`applySocleFormPrefill`).
  "location",
]);

function parseOptions(raw: unknown): FillableFieldOption[] {
  if (!Array.isArray(raw)) return [];
  const out: FillableFieldOption[] = [];
  for (const o of raw) {
    if (!o || typeof o !== "object") continue;
    const { value, label } = o as Record<string, unknown>;
    if (typeof value !== "string" || value.length === 0) continue;
    out.push({ value, label: typeof label === "string" && label ? label : value });
  }
  return out;
}

function parseField(raw: unknown): FillableField | null {
  if (!raw || typeof raw !== "object") return null;
  const f = raw as Record<string, unknown>;
  if (typeof f.type !== "string" || !FILLABLE_TYPES.has(f.type)) return null;
  if (typeof f.id !== "string" || f.id.length === 0) return null;
  const key = typeof f.key === "string" && f.key.trim() ? f.key.trim() : f.id;
  return {
    id: f.id,
    prefillKey: key,
    label: typeof f.label === "string" ? f.label : "",
    type: f.type,
    options: parseOptions(f.options),
    help: typeof f.help === "string" && f.help.trim() ? f.help.trim() : null,
  };
}

/**
 * Aplati les champs remplissables d'un `form_schema` (champs racine + sections,
 * pièces jointes exclues). Parseur tolérant : structure invalide → []. Les
 * `prefillKey` en double sont dédoublonnées (première occurrence gagne).
 */
export function extractFillableFields(rawFormSchema: unknown): FillableField[] {
  if (!rawFormSchema || typeof rawFormSchema !== "object") return [];
  const content = (rawFormSchema as Record<string, unknown>).content;
  if (!Array.isArray(content)) return [];

  const out: FillableField[] = [];
  const seen = new Set<string>();
  const push = (raw: unknown) => {
    const field = parseField(raw);
    if (!field || seen.has(field.prefillKey)) return;
    seen.add(field.prefillKey);
    out.push(field);
  };

  for (const node of content) {
    if (node && typeof node === "object" && (node as Record<string, unknown>).kind === "section") {
      const fields = (node as Record<string, unknown>).fields;
      if (Array.isArray(fields)) fields.forEach(push);
    } else {
      push(node);
    }
  }
  return out;
}

// ── Condensé de la base de connaissance Socle ───────────────────────────────

/**
 * Condense le bloc `knowledge_base` d'une démarche (aide agent, procédures,
 * FAQ, garde-fous) en texte court pour le prompt de préremplissage. Les
 * documents/liens (trainingDocuments, aiSources…) sont hors périmètre.
 */
export function condenseKnowledgeBase(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "";
  const kb = raw as Record<string, unknown>;
  const sections: string[] = [];

  const text = (v: unknown, label: string, max: number) => {
    if (typeof v === "string" && v.trim()) sections.push(`${label} : ${truncate(v, max)}`);
  };
  text(kb.agentHelpText, "Aide agent", 800);
  text(kb.proceduresText, "Procédures", 800);

  if (Array.isArray(kb.faq)) {
    const entries = kb.faq
      .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
      .map((e) => ({ q: e.question, a: e.answer }))
      .filter((e) => typeof e.q === "string" && e.q.trim())
      .slice(0, 3)
      .map((e) => `Q: ${truncate(e.q as string, 200)}${typeof e.a === "string" && e.a.trim() ? ` R: ${truncate(e.a, 300)}` : ""}`);
    if (entries.length > 0) sections.push(`FAQ :\n${entries.join("\n")}`);
  }

  if (Array.isArray(kb.guardrails)) {
    const rails = kb.guardrails.filter((g): g is string => typeof g === "string" && g.trim().length > 0);
    if (rails.length > 0) sections.push(`Garde-fous : ${truncate(rails.join(" ; "), 400)}`);
  }

  return sections.join("\n");
}

// ── Sélection des démarches candidates au préremplissage ────────────────────

export interface PrefillProcedureSource {
  id: string;
  name: string;
  external_source: string | null;
  external_reference_id?: string | null;
  arpege_config_fields?: unknown;
  form_schema?: unknown;
  knowledge_base?: unknown;
}

export interface SelectedProcedure {
  id: string;
  name: string;
  fields: FillableField[];
  knowledge: string;
}

/**
 * Démarches à soumettre à l'appel de préremplissage : celles pointées par les
 * actions (dans l'ordre, dédoublonnées), Socle natives (les démarches adoptées
 * qui gardent leur config Arpège suivent le flux Arpège du dialog — même règle
 * que `isArpege` côté client) et ayant au moins un champ remplissable.
 */
export function selectPrefillCandidates(
  actions: Array<{ procedure_id?: string | null }>,
  procedures: PrefillProcedureSource[],
  cap = 3,
): SelectedProcedure[] {
  const byId = new Map(procedures.map((p) => [p.id, p]));
  const out: SelectedProcedure[] = [];
  const seen = new Set<string>();

  for (const action of actions) {
    if (out.length >= cap) break;
    const id = action.procedure_id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const proc = byId.get(id);
    if (!proc || proc.external_source !== "socle") continue;
    if (proc.external_reference_id && proc.arpege_config_fields) continue; // flux Arpège
    const fields = extractFillableFields(proc.form_schema);
    if (fields.length === 0) continue;
    out.push({
      id: proc.id,
      name: proc.name,
      fields,
      knowledge: condenseKnowledgeBase(proc.knowledge_base),
    });
  }
  return out;
}

// ── Préremplissage : schéma de sortie dynamique + bloc de prompt ────────────

export const PREFILL_AUDIENCES = ["citoyen", "entreprise", "association"] as const;
export type PrefillAudience = (typeof PREFILL_AUDIENCES)[number];

type JsonSchema = Record<string, unknown>;

/**
 * Idiome maison : tout `required`, chaîne vide = sentinelle « absent ».
 * Le schéma est l'UNIQUE description des champs envoyée au LLM (label, aide et
 * mapping code=libellé des options vivent dans `description`) — pas de rappel
 * dans le prompt, pour éviter la duplication de tokens.
 */
function fieldJsonSchema(field: FillableField): JsonSchema {
  const label = field.label || field.prefillKey;
  const help = field.help ? ` (${truncate(field.help, 150)})` : "";
  const optionsMap = field.options.map((o) => `${o.value}=${o.label}`).join(", ");
  switch (field.type) {
    case "select":
    case "radio":
      return {
        type: "string",
        enum: ["", ...field.options.map((o) => o.value)],
        description: `${label}${help} — options : ${optionsMap} ; code exact de l'option ("" si non déterminable)`,
      };
    case "checkboxes":
      return {
        type: "array",
        items: { type: "string", enum: field.options.map((o) => o.value) },
        description: `${label}${help} — options : ${optionsMap} ; codes exacts des options cochées (tableau vide si aucune)`,
      };
    case "boolean":
      return {
        type: "string",
        enum: ["", "true", "false"],
        description: `${label}${help} — "true"/"false" ("" si non déterminable)`,
      };
    case "date":
      return { type: "string", description: `${label}${help} — format YYYY-MM-DD ("" si absent)` };
    case "number":
      return { type: "string", description: `${label}${help} — nombre ("" si absent)` };
    case "location":
      return {
        type: "string",
        description: `${label}${help} — adresse du lieu concerné sur une ligne (numéro, voie, code postal, commune), ou repère précis cité par le courrier ("" si absent)`,
      };
    default:
      return { type: "string", description: `${label}${help} ("" si absent du courrier)` };
  }
}

export interface PrefillTool {
  /** Schéma JSON de la réponse attendue, joint au prompt système. */
  toolParameters: JsonSchema;
  /** Descriptif des démarches et de leurs champs, à injecter dans le prompt. */
  promptBlock: string;
}

export function buildPrefillTool(selected: SelectedProcedure[]): PrefillTool {
  const properties: Record<string, JsonSchema> = {};
  const blocks: string[] = [];

  for (const proc of selected) {
    const formProperties: Record<string, JsonSchema> = {};
    for (const field of proc.fields) formProperties[field.prefillKey] = fieldJsonSchema(field);

    properties[proc.id] = {
      type: "object",
      properties: {
        audience: {
          type: "string",
          enum: ["", ...PREFILL_AUDIENCES],
          description: `Nature du demandeur pour « ${proc.name} » ("" si indéterminable)`,
        },
        form: {
          type: "object",
          properties: formProperties,
          required: Object.keys(formProperties),
          additionalProperties: false,
        },
      },
      required: ["audience", "form"],
      additionalProperties: false,
    };

    // Les champs sont décrits UNIQUEMENT par le schéma du tool ; le prompt ne
    // porte que l'identité de la démarche et sa base de connaissance.
    const lines = [`Démarche « ${proc.name} » [id: ${proc.id}]`];
    if (proc.knowledge) lines.push(`Connaissances sur cette démarche :\n${proc.knowledge}`);
    blocks.push(lines.join("\n"));
  }

  return {
    toolParameters: {
      type: "object",
      properties,
      required: Object.keys(properties),
      additionalProperties: false,
    },
    promptBlock: blocks.join("\n\n"),
  };
}

// ── Planification des appels de préremplissage ──────────────────────────────
// La fiabilité du tool-calling se dégrade avec la taille du schéma : au-delà
// d'un seuil déterministe, on scinde en un appel par démarche (avec un contenu
// de courrier réduit pour contenir le coût). Le cap de champs borne les
// démarches pathologiques.

export interface PrefillCallLimits {
  /** Champs max injectés par démarche (au-delà : tronqué, préremplissage partiel). */
  maxFieldsPerProcedure: number;
  /** Taille max (chars JSON) du schéma d'un appel groupé avant scission. */
  maxSchemaChars: number;
  /** Plafond de contenu du courrier (chars) pour un appel groupé. */
  contentMaxGrouped: number;
  /** Plafond de contenu du courrier (chars) par appel scindé. */
  contentMaxSplit: number;
}

export const DEFAULT_PREFILL_LIMITS: PrefillCallLimits = {
  maxFieldsPerProcedure: 40,
  maxSchemaChars: 6_000,
  contentMaxGrouped: 15_000,
  contentMaxSplit: 10_000,
};

export interface PrefillCall {
  procedures: SelectedProcedure[];
  tool: PrefillTool;
  contentMax: number;
}

function capFields(
  proc: SelectedProcedure,
  limits: PrefillCallLimits,
): SelectedProcedure {
  if (proc.fields.length <= limits.maxFieldsPerProcedure) return proc;
  console.warn(
    `report_prefill: démarche ${proc.id} tronquée à ${limits.maxFieldsPerProcedure} champs (${proc.fields.length} déclarés)`,
  );
  return { ...proc, fields: proc.fields.slice(0, limits.maxFieldsPerProcedure) };
}

/**
 * Planifie les appels report_prefill : un appel groupé si le schéma tient sous
 * `maxSchemaChars`, sinon un appel par démarche avec contenu réduit.
 */
export function planPrefillCalls(
  candidates: SelectedProcedure[],
  limits: PrefillCallLimits = DEFAULT_PREFILL_LIMITS,
): PrefillCall[] {
  if (candidates.length === 0) return [];
  const capped = candidates.map((p) => capFields(p, limits));
  const grouped = buildPrefillTool(capped);
  if (JSON.stringify(grouped.toolParameters).length <= limits.maxSchemaChars) {
    return [{ procedures: capped, tool: grouped, contentMax: limits.contentMaxGrouped }];
  }
  return capped.map((p) => ({
    procedures: [p],
    tool: buildPrefillTool([p]),
    contentMax: limits.contentMaxSplit,
  }));
}

/**
 * Repli après échec d'un appel groupé (JSON tronqué, réponse invalide) :
 * rejoue chaque démarche dans son propre appel. Vide si déjà scindé.
 */
export function splitPrefillCall(
  call: PrefillCall,
  limits: PrefillCallLimits = DEFAULT_PREFILL_LIMITS,
): PrefillCall[] {
  if (call.procedures.length <= 1) return [];
  return call.procedures.map((p) => ({
    procedures: [p],
    tool: buildPrefillTool([p]),
    contentMax: limits.contentMaxSplit,
  }));
}

// ── Sanitisation de la sortie du tool (double rideau) ───────────────────────

export interface SanitizedPrefill {
  audience: PrefillAudience | null;
  form: Record<string, unknown>;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const NUMBER_RE = /^-?\d+(?:[.,]\d+)?$/;
const TEXT_VALUE_MAX = 2000;

function sanitizeFieldValue(field: FillableField, raw: unknown): unknown | undefined {
  switch (field.type) {
    case "select":
    case "radio": {
      if (typeof raw !== "string") return undefined;
      return field.options.some((o) => o.value === raw) ? raw : undefined;
    }
    case "checkboxes": {
      if (!Array.isArray(raw)) return undefined;
      const valid = new Set(field.options.map((o) => o.value));
      const values = raw.filter((v): v is string => typeof v === "string" && valid.has(v));
      return values.length > 0 ? values : undefined;
    }
    case "boolean":
      // Seul "true" apporte une information (false = case décochée par défaut).
      return raw === "true" || raw === true ? true : undefined;
    case "date": {
      if (typeof raw !== "string" || !DATE_RE.test(raw.trim())) return undefined;
      return raw.trim();
    }
    case "number": {
      if (typeof raw !== "string" || !NUMBER_RE.test(raw.trim())) return undefined;
      return raw.trim().replace(",", ".");
    }
    default: {
      if (typeof raw !== "string") return undefined;
      const v = raw.trim();
      return v ? v.slice(0, TEXT_VALUE_MAX) : undefined;
    }
  }
}

/**
 * Valide la sortie brute du préremplissage contre les démarches effectivement
 * soumises : clés inconnues supprimées, valeurs d'options vérifiées,
 * coercitions. Ne retourne que les démarches avec du contenu.
 *
 * ⚠️ C'EST LA VRAIE DÉFENSE, et elle l'était déjà avant la centralisation IA.
 * Le guichet garantit que la réponse PARSE (`response_format: "json"`), jamais
 * qu'elle respecte le schéma — pas plus que le tool-calling ne le garantissait.
 */
export function sanitizePrefillArguments(
  rawArgs: unknown,
  selected: SelectedProcedure[],
): Record<string, SanitizedPrefill> {
  const out: Record<string, SanitizedPrefill> = {};
  if (!rawArgs || typeof rawArgs !== "object") return out;
  const args = rawArgs as Record<string, unknown>;

  for (const proc of selected) {
    const entry = args[proc.id];
    if (!entry || typeof entry !== "object") continue;
    const { audience, form } = entry as Record<string, unknown>;

    const safeAudience = typeof audience === "string" &&
        (PREFILL_AUDIENCES as readonly string[]).includes(audience)
      ? (audience as PrefillAudience)
      : null;

    const safeForm: Record<string, unknown> = {};
    if (form && typeof form === "object") {
      const rawForm = form as Record<string, unknown>;
      for (const field of proc.fields) {
        const value = sanitizeFieldValue(field, rawForm[field.prefillKey]);
        if (value !== undefined) safeForm[field.prefillKey] = value;
      }
    }

    if (safeAudience || Object.keys(safeForm).length > 0) {
      out[proc.id] = { audience: safeAudience, form: safeForm };
    }
  }
  return out;
}

// ── Organisation destinataire suggérée ──────────────────────────────────────

/**
 * Retient l'organisation à qui adresser la demande. Le modèle PROPOSE, la
 * fonction dispose — même défense que pour `procedure_id` : un id bien formé
 * n'est pas un id valide, et une organisation qui n'assure pas la démarche
 * vaut un refus d'Iris.
 *
 * `offering` = organisations qui assurent la démarche (vide = démarche hors
 * référentiel : aucune contrainte, on accepte toute organisation connue).
 * Quand une seule organisation l'assure, elle s'impose : rien à deviner.
 */
export function resolveSuggestedOrganization(
  proposed: string | null | undefined,
  offering: OrganizationRef[],
  known: Map<string, OrganizationRef>,
): OrganizationRef | null {
  const id = typeof proposed === "string" && proposed.length > 0 ? proposed : null;
  if (offering.length > 0) {
    const chosen = id ? offering.find((o) => o.id === id) : undefined;
    if (chosen) return chosen;
    return offering.length === 1 ? offering[0] : null;
  }
  return (id && known.get(id)) || null;
}

// ── Injection dans les actions suggérées ────────────────────────────────────

export interface ActionWithPrefill {
  label: string;
  procedure_id: string | null;
  procedure_name: string | null;
  socle_organization_id: string | null;
  socle_organization_name: string | null;
  prefill: Record<string, string>;
  socle_prefill?: SanitizedPrefill;
}

export function attachSoclePrefill<T extends { procedure_id: string | null }>(
  actions: T[],
  sanitized: Record<string, SanitizedPrefill>,
): Array<T & { socle_prefill?: SanitizedPrefill }> {
  return actions.map((action) => {
    const prefill = action.procedure_id ? sanitized[action.procedure_id] : undefined;
    return prefill ? { ...action, socle_prefill: prefill } : action;
  });
}
