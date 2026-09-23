/**
 * Contrat des démarches Socle — port côté Clara (lecture seule).
 * Réplique les types et la logique publiés par le Socle (`formSchema.ts`,
 * `conditions.ts`, `requesterFields.ts`) pour rendre dans Clara les blocs
 * `procedures.form_schema` et `procedures.requester_config` synchronisés.
 * Le Socle reste propriétaire du contrat : ne pas étendre ces types ici.
 */
import { z } from "zod";

// ── Conditions (visibleIf / requiredIf) ─────────────────────────────────────

export type ConditionOperator =
  | "equals"
  | "notEquals"
  | "includes"
  | "isEmpty"
  | "isNotEmpty";

export interface ConditionRule {
  /** id du champ dont dépend la règle. */
  fieldId: string;
  operator: ConditionOperator;
  /** Valeur de comparaison (ignorée pour isEmpty/isNotEmpty). */
  value?: string | string[];
}

export interface Condition {
  combinator: "and" | "or";
  rules: ConditionRule[];
}

/** Valeurs saisies dans le formulaire, indexées par id de champ. */
export type FormValues = Record<string, unknown>;

function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function asScalar(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

/** Égalité tolérante ; pour un champ multi-valeurs, vrai si `target` est sélectionné. */
function valueEquals(fieldValue: unknown, target: string): boolean {
  if (Array.isArray(fieldValue)) return fieldValue.map(String).includes(target);
  if (fieldValue === undefined || fieldValue === null) return false;
  return String(fieldValue) === target;
}

function valueIncludes(fieldValue: unknown, target: string): boolean {
  if (Array.isArray(fieldValue)) return fieldValue.map(String).includes(target);
  if (typeof fieldValue === "string") return fieldValue.includes(target);
  return false;
}

export function evaluateRule(rule: ConditionRule, values: FormValues): boolean {
  const fieldValue = values[rule.fieldId];
  switch (rule.operator) {
    case "isEmpty":
      return isEmptyValue(fieldValue);
    case "isNotEmpty":
      return !isEmptyValue(fieldValue);
    case "equals":
      return valueEquals(fieldValue, asScalar(rule.value));
    case "notEquals":
      return !valueEquals(fieldValue, asScalar(rule.value));
    case "includes":
      return valueIncludes(fieldValue, asScalar(rule.value));
    default:
      return false;
  }
}

/**
 * Évalue une condition complète. Une condition absente ou sans règle est
 * considérée comme satisfaite (élément toujours affiché / facultatif).
 */
export function evaluateCondition(
  condition: Condition | undefined | null,
  values: FormValues,
): boolean {
  if (!condition || condition.rules.length === 0) return true;
  const results = condition.rules.map((rule) => evaluateRule(rule, values));
  return condition.combinator === "or" ? results.some(Boolean) : results.every(Boolean);
}

// ── Schéma de formulaire (procedures.form_schema) ───────────────────────────

export type SocleFieldType =
  | "text"
  | "textarea"
  | "number"
  | "date"
  | "email"
  | "phone"
  | "boolean"
  | "select"
  | "radio"
  | "checkboxes"
  | "attachment"
  | "location";

export interface SocleFieldOption {
  value: string;
  label: string;
}

interface SocleFieldCommon {
  id: string;
  /** Clé machine — la donnée du contrat consommée en aval. */
  key: string;
  label: string;
  help?: string;
  placeholder?: string;
  required?: boolean;
  /** Affiché seulement si la condition est satisfaite (sinon masqué). */
  visibleIf?: Condition;
}

export interface SocleSimpleField extends SocleFieldCommon {
  type: "text" | "textarea" | "number" | "date" | "email" | "phone" | "boolean";
  maxLength?: number;
}

export interface SocleChoiceField extends SocleFieldCommon {
  type: "select" | "radio" | "checkboxes";
  options: SocleFieldOption[];
}

export interface SocleAttachmentField extends SocleFieldCommon {
  type: "attachment";
  documentTypeId?: string;
  /** 1 = un seul fichier ; 2..5 = plusieurs fichiers. */
  maxFiles: number;
  /** Formats de fichier acceptés (ex. ["pdf", "jpg"]). */
  acceptedFormats: string[];
  /** Obligatoire si la condition est satisfaite. */
  requiredIf?: Condition;
}

/**
 * Lieu d'intervention (Socle 1.29.0, 2026-09-22) : une adresse sur une ligne et
 * le point retenu. Reconnu par son TYPE, jamais par sa clé (`intervention_lieu`
 * n'est qu'un défaut). Sa réponse est un objet `LocationValue`, pas une chaîne.
 */
export interface SocleLocationField extends SocleFieldCommon {
  type: "location";
}

export type SocleField =
  | SocleSimpleField
  | SocleChoiceField
  | SocleAttachmentField
  | SocleLocationField;

// ── Valeur d'un lieu d'intervention (contrat `LocationValue`) ───────────────

export const LOCATION_PRECISIONS = ["adresse", "voie", "lieu_dit", "commune"] as const;
export type LocationPrecision = (typeof LOCATION_PRECISIONS)[number];

export interface LocationValue {
  /** Libellé BAN retenu, sinon le texte tapé — jamais vide. */
  address: string;
  /** Point retenu (WGS 84) ; `lat` et `lon` vont ensemble, `null` en saisie libre. */
  lat: number | null;
  lon: number | null;
  precision: LocationPrecision | null;
  /** Point déplacé par l'usager (portail) : jamais vrai pour une saisie d'agent. */
  adjusted: boolean;
}

function finiteCoordinate(raw: unknown, bound: number): number | null {
  return typeof raw === "number" && Number.isFinite(raw) && Math.abs(raw) <= bound ? raw : null;
}

/**
 * Lecture tolérante d'une valeur de lieu — port d'Iris (`procedureForm.ts`).
 * Un objet illisible (adresse vide…) vaut non renseigné ; une chaîne (préremplissage
 * IA) devient une adresse sans point. `lat` sans `lon` : pas de point du tout.
 */
export function parseLocationValue(raw: unknown): LocationValue | null {
  if (typeof raw === "string") {
    const address = raw.trim();
    return address === "" ? null : { address, lat: null, lon: null, precision: null, adjusted: false };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const address = typeof r.address === "string" ? r.address.trim() : "";
  if (address === "") return null;
  const lat = finiteCoordinate(r.lat, 90);
  const lon = finiteCoordinate(r.lon, 180);
  const hasPoint = lat !== null && lon !== null;
  const precision = (LOCATION_PRECISIONS as readonly unknown[]).includes(r.precision)
    ? (r.precision as LocationPrecision)
    : null;
  return {
    address,
    lat: hasPoint ? lat : null,
    lon: hasPoint ? lon : null,
    precision,
    adjusted: hasPoint && r.adjusted === true,
  };
}

/**
 * L'adresse d'un lieu telle qu'elle a été TAPÉE, pour la réafficher dans le
 * champ : sans rogner. ⚠️ Réafficher `parseLocationValue(v).address` rendrait
 * l'espace intapable (elle disparaît à la frappe) — vécu dans Iris.
 */
export function locationAddressText(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const address = (raw as Record<string, unknown>).address;
    if (typeof address === "string") return address;
  }
  return "";
}

export interface SocleSection {
  id: string;
  kind: "section";
  title: string;
  description?: string;
  visibleIf?: Condition;
  fields: SocleField[];
}

export type SocleFormNode = SocleField | SocleSection;

export interface SocleFormSchema {
  version: 1;
  content: SocleFormNode[];
}

export function isSection(node: SocleFormNode): node is SocleSection {
  return "kind" in node && node.kind === "section";
}

const conditionZod = z.object({
  combinator: z.enum(["and", "or"]),
  rules: z.array(
    z.object({
      fieldId: z.string(),
      operator: z.enum(["equals", "notEquals", "includes", "isEmpty", "isNotEmpty"]),
      value: z.union([z.string(), z.array(z.string())]).optional(),
    }),
  ),
});

const fieldCommonShape = {
  id: z.string(),
  key: z.string(),
  label: z.string(),
  help: z.string().optional(),
  placeholder: z.string().optional(),
  required: z.boolean().optional(),
  visibleIf: conditionZod.optional(),
};

const simpleFieldZod = z.object({
  ...fieldCommonShape,
  type: z.enum(["text", "textarea", "number", "date", "email", "phone", "boolean"]),
  maxLength: z.number().optional(),
});

const choiceFieldZod = z.object({
  ...fieldCommonShape,
  type: z.enum(["select", "radio", "checkboxes"]),
  options: z.array(z.object({ value: z.string(), label: z.string() })).default([]),
});

const attachmentFieldZod = z.object({
  ...fieldCommonShape,
  type: z.literal("attachment"),
  documentTypeId: z.string().optional(),
  maxFiles: z.number().default(1),
  acceptedFormats: z.array(z.string()).default([]),
  requiredIf: conditionZod.optional(),
});

const locationFieldZod = z.object({
  ...fieldCommonShape,
  type: z.literal("location"),
});

// Ordre important : les schémas les plus spécifiques (choix, PJ, lieu) avant le simple.
const fieldZod = z.union([choiceFieldZod, attachmentFieldZod, locationFieldZod, simpleFieldZod]);

const sectionHeadZod = z.object({
  id: z.string(),
  kind: z.literal("section"),
  title: z.string(),
  description: z.string().optional(),
  visibleIf: conditionZod.optional(),
  fields: z.array(z.unknown()).default([]),
});

const formSchemaHeadZod = z.object({
  version: z.literal(1).default(1),
  content: z.array(z.unknown()).default([]),
});

/** Les champs lisibles d'une liste ; un champ de type inconnu est écarté SEUL. */
function parseFields(raw: unknown[]): SocleField[] {
  const out: SocleField[] = [];
  for (const item of raw) {
    const field = fieldZod.safeParse(item);
    if (field.success) out.push(field.data as SocleField);
  }
  return out;
}

/**
 * Transforme le JSON stocké (arbitraire) en `SocleFormSchema` valide.
 *
 * ⚠️ Lecture NŒUD PAR NŒUD : un champ que Clara ne sait pas lire (type ajouté
 * au contrat du Socle depuis, forme abîmée) est écarté seul, le reste du
 * formulaire est rendu. Le Socle fait évoluer le contrat en ajoutant des types
 * (`location`, 1.29.0) et demande aux consommateurs d'ignorer ceux qu'ils ne
 * connaissent pas. Un parse d'un seul bloc vidait tout le formulaire en
 * silence : le 2026-09-23, une action Rosny est partie dans Iris sans aucune
 * réponse, faute de connaître `location`.
 */
export function parseFormSchema(raw: unknown): SocleFormSchema {
  const head = formSchemaHeadZod.safeParse(raw ?? {});
  if (!head.success) return { version: 1, content: [] };
  const content: SocleFormNode[] = [];
  for (const node of head.data.content) {
    const section = sectionHeadZod.safeParse(node);
    if (section.success) {
      content.push({ ...section.data, fields: parseFields(section.data.fields) } as SocleSection);
      continue;
    }
    content.push(...parseFields([node]));
  }
  return { version: 1, content };
}

// ── Configuration demandeur (procedures.requester_config) ───────────────────

export type Audience = "citoyen" | "entreprise" | "association";

export type FieldVisibility = "obligatoire" | "visible" | "masque";

export interface RequesterFieldDef {
  key: string;
  label: string;
}

const CITOYEN_FIELDS: RequesterFieldDef[] = [
  { key: "civilite", label: "Civilité" },
  { key: "nom_naissance", label: "Nom de naissance" },
  { key: "nom_usuel", label: "Nom usuel" },
  { key: "prenoms", label: "Prénom(s)" },
  { key: "adresse", label: "Adresse" },
  { key: "tel_portable", label: "Numéro de téléphone portable" },
  { key: "tel_fixe", label: "Numéro de téléphone fixe" },
  { key: "courriel", label: "Courriel" },
];

// Entreprises et associations partagent le même jeu de champs.
const ORGANISATION_FIELDS: RequesterFieldDef[] = [
  { key: "siret", label: "SIRET" },
  { key: "raison_sociale", label: "Raison sociale" },
  { key: "adresse", label: "Adresse" },
  { key: "tel_portable", label: "Numéro de téléphone portable" },
  { key: "tel_fixe", label: "Numéro de téléphone fixe" },
  { key: "courriel", label: "Courriel" },
];

export const AUDIENCES: { key: Audience; label: string; fields: RequesterFieldDef[] }[] = [
  { key: "citoyen", label: "Citoyen", fields: CITOYEN_FIELDS },
  { key: "entreprise", label: "Entreprise", fields: ORGANISATION_FIELDS },
  { key: "association", label: "Association", fields: ORGANISATION_FIELDS },
];

export interface AudienceConfig {
  enabled: boolean;
  fields: Record<string, FieldVisibility>;
}

export type RequesterConfig = Record<Audience, AudienceConfig>;

const VALID_VISIBILITIES: readonly FieldVisibility[] = ["obligatoire", "visible", "masque"];

/** État par défaut d'un champ : masqué (minimisation des données). */
const DEFAULT_VISIBILITY: FieldVisibility = "masque";

function defaultAudienceConfig(fields: RequesterFieldDef[]): AudienceConfig {
  const map: Record<string, FieldVisibility> = {};
  for (const f of fields) map[f.key] = DEFAULT_VISIBILITY;
  return { enabled: false, fields: map };
}

function coerceVisibility(value: unknown): FieldVisibility {
  return typeof value === "string" && VALID_VISIBILITIES.includes(value as FieldVisibility)
    ? (value as FieldVisibility)
    : DEFAULT_VISIBILITY;
}

/**
 * Fusionne une config stockée (JSON arbitraire venant de la sync) avec les
 * valeurs par défaut : ignore les publics/champs inconnus, corrige les valeurs
 * invalides, complète les champs manquants. Toujours une config complète en sortie.
 */
export function parseRequesterConfig(raw: unknown): RequesterConfig {
  const config: RequesterConfig = {
    citoyen: defaultAudienceConfig(CITOYEN_FIELDS),
    entreprise: defaultAudienceConfig(ORGANISATION_FIELDS),
    association: defaultAudienceConfig(ORGANISATION_FIELDS),
  };
  if (!raw || typeof raw !== "object") return config;

  const stored = raw as Record<string, unknown>;
  for (const audience of AUDIENCES) {
    const audienceRaw = stored[audience.key];
    if (!audienceRaw || typeof audienceRaw !== "object") continue;

    const { enabled, fields } = audienceRaw as { enabled?: unknown; fields?: unknown };
    if (typeof enabled === "boolean") config[audience.key].enabled = enabled;

    if (fields && typeof fields === "object") {
      const storedFields = fields as Record<string, unknown>;
      for (const field of audience.fields) {
        if (field.key in storedFields) {
          config[audience.key].fields[field.key] = coerceVisibility(storedFields[field.key]);
        }
      }
    }
  }
  return config;
}

// ── Helpers de rendu et de validation côté Clara ────────────────────────────

/** Publics activés dans la config, dans l'ordre d'affichage du Socle. */
export function enabledAudiences(config: RequesterConfig): Audience[] {
  return AUDIENCES.filter((a) => config[a.key].enabled).map((a) => a.key);
}

export interface RequesterDisplayField extends RequesterFieldDef {
  required: boolean;
}

/** Champs demandeur à afficher pour un public : obligatoires et visibles (masqués exclus). */
export function requesterFieldsFor(
  config: RequesterConfig,
  audience: Audience,
): RequesterDisplayField[] {
  const def = AUDIENCES.find((a) => a.key === audience);
  if (!def) return [];
  return def.fields
    .filter((f) => config[audience].fields[f.key] !== "masque")
    .map((f) => ({ ...f, required: config[audience].fields[f.key] === "obligatoire" }));
}

export function requesterRequiredMet(
  config: RequesterConfig,
  audience: Audience,
  values: Record<string, string>,
): boolean {
  return requesterFieldsFor(config, audience)
    .filter((f) => f.required)
    .every((f) => (values[f.key] ?? "").trim().length > 0);
}

/**
 * Champs effectivement affichés : conditions évaluées au niveau des sections
 * ET des champs (un champ d'une section masquée est masqué).
 */
export function visibleFields(schema: SocleFormSchema, values: FormValues): SocleField[] {
  const out: SocleField[] = [];
  for (const node of schema.content) {
    if (isSection(node)) {
      if (!evaluateCondition(node.visibleIf, values)) continue;
      for (const f of node.fields) {
        if (evaluateCondition(f.visibleIf, values)) out.push(f);
      }
    } else if (evaluateCondition(node.visibleIf, values)) {
      out.push(node);
    }
  }
  return out;
}

/**
 * Caractère obligatoire d'un champ — implémentation de référence du Socle
 * (FormPreview) : pour une pièce jointe, seul `requiredIf` compte.
 */
export function isFieldRequired(field: SocleField, values: FormValues): boolean {
  if (field.type === "attachment") {
    return field.requiredIf != null && evaluateCondition(field.requiredIf, values);
  }
  return field.required ?? false;
}

/**
 * Vrai si tous les champs obligatoires **visibles** sont remplis. Les pièces
 * jointes sont satisfaites par au moins un document sélectionné ; un booléen
 * obligatoire doit être coché.
 */
export function formRequiredMet(
  schema: SocleFormSchema,
  values: FormValues,
  attachments: Record<string, string[]>,
): boolean {
  return visibleFields(schema, values).every((f) => {
    if (!isFieldRequired(f, values)) return true;
    if (f.type === "attachment") return (attachments[f.id]?.length ?? 0) > 0;
    if (f.type === "boolean") return values[f.id] === true;
    if (f.type === "location") return parseLocationValue(values[f.id]) !== null;
    return !isEmptyValue(values[f.id]);
  });
}

// ── Payload persisté sur le ticket (action_tickets.socle_data) ──────────────

export interface SocleFormEntry {
  id: string;
  key: string;
  label: string;
  type: SocleFieldType;
  value: unknown;
  /** Libellé(s) lisible(s) pour les champs à choix. */
  valueLabel?: string;
}

export interface SocleDemandeData {
  demandeur: {
    audience: Audience;
    /** Valeurs saisies, indexées par clé de champ (civilite, courriel…). */
    values: Record<string, string>;
  } | null;
  form: SocleFormEntry[];
  /** Ids des documents du courrier sélectionnés, par id de champ pièce jointe. */
  pieces_jointes: Record<string, string[]>;
}

function choiceLabel(field: SocleChoiceField, value: unknown): string | undefined {
  const labelOf = (v: string) => field.options.find((o) => o.value === v)?.label ?? v;
  if (Array.isArray(value)) return value.map((v) => labelOf(String(v))).join(", ");
  if (typeof value === "string" && value) return labelOf(value);
  return undefined;
}

/**
 * Construit le bloc persisté avec le ticket : seuls les champs visibles et
 * renseignés sont conservés (les valeurs de champs masqués par condition ne
 * font pas partie de la demande).
 */
export function buildSocleDemandeData(input: {
  config: RequesterConfig | null;
  audience: Audience | null;
  requesterValues: Record<string, string>;
  schema: SocleFormSchema;
  formValues: FormValues;
  attachments: Record<string, string[]>;
}): SocleDemandeData {
  const { config, audience, requesterValues, schema, formValues, attachments } = input;

  let demandeur: SocleDemandeData["demandeur"] = null;
  if (config && audience) {
    const values: Record<string, string> = {};
    for (const f of requesterFieldsFor(config, audience)) {
      const v = (requesterValues[f.key] ?? "").trim();
      if (v) values[f.key] = v;
    }
    demandeur = { audience, values };
  }

  const fields = visibleFields(schema, formValues);
  const form: SocleFormEntry[] = [];
  const pieces: Record<string, string[]> = {};
  for (const f of fields) {
    if (f.type === "attachment") {
      const docs = attachments[f.id] ?? [];
      if (docs.length > 0) pieces[f.id] = docs;
      continue;
    }
    // Un lieu part NORMALISÉ (adresse rognée, point entier ou absent) : c'est
    // la forme que la frontière d'Iris revalide.
    const value = f.type === "location" ? parseLocationValue(formValues[f.id]) : formValues[f.id];
    if (isEmptyValue(value) || value === false) continue;
    const entry: SocleFormEntry = { id: f.id, key: f.key, label: f.label, type: f.type, value };
    if (f.type === "select" || f.type === "radio" || f.type === "checkboxes") {
      entry.valueLabel = choiceLabel(f, value);
    } else if (f.type === "location") {
      entry.valueLabel = (value as LocationValue).address;
    }
    form.push(entry);
  }

  return { demandeur, form, pieces_jointes: pieces };
}
