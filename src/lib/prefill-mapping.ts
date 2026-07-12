/**
 * Préremplissage des formulaires de demande (CreateTicketDialog) : mappings
 * entre les sources de données (usager lié à l'expéditeur, participant sender
 * brut, extraction LLM de l'analyse) et les clés des formulaires demandeur
 * Socle et Arpège, plus l'application du préremplissage LLM au form_schema.
 * Logique pure, sans dépendance React/Supabase.
 */
import type { Usager } from "@/services/usagerService";
import {
  isSection,
  type Audience,
  type FormValues,
  type SocleField,
  type SocleFormSchema,
} from "./socle-form";

/** Sous-ensemble utile d'un participant `role="sender"` d'un courrier. */
export interface SenderParticipantLike {
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  organization?: string | null;
  usager_id?: string | null;
}

/** Prefill LLM historique (clés Arpège), tel que stocké dans suggested_actions. */
export type ArpegePrefill = Partial<Record<
  "CIVILITE" | "NOM_USUEL" | "NOM_NAISSANCE" | "PRENOMS" |
  "DATE_NAISSANCE" | "EMAIL" | "TEL_FIXE" | "TEL_MOBILE",
  string
>>;

/** Préremplissage Socle d'une action suggérée (produit par analyze-courier). */
export interface SoclePrefill {
  audience?: string | null;
  /** Valeurs par clé de champ du form_schema (key, ou id si key vide). */
  form?: Record<string, unknown> | null;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Adresse structurée d'un usager sur une ligne (même logique que Usagers.tsx). */
export function formatUsagerAddressInline(u: Usager): string {
  const line1 = [u.address_number, u.address_btq, u.address_street].filter(Boolean).join(" ");
  const line2 = [u.address_building, u.address_apartment].filter(Boolean).join(" ");
  const line3 = [u.address_postal_code, u.address_city].filter(Boolean).join(" ");
  return [line1, line2, u.address_complement, line3]
    .filter((l) => l && l.trim().length > 0)
    .join(", ");
}

/** Heuristique numéro mobile français (06/07, avec ou sans indicatif +33). */
export function isFrenchMobile(phone: string): boolean {
  const digits = phone.replace(/[\s().-]/g, "");
  return /^(?:\+33|0033)?0?[67]\d{8}$/.test(digits) || /^0[67]/.test(digits);
}

/**
 * Fusionne deux jeux de valeurs : les valeurs non vides de `preferred`
 * écrasent celles de `fallback` ; les valeurs vides sont écartées.
 */
export function mergeNonEmpty(
  preferred: Record<string, string>,
  fallback: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const source of [fallback, preferred]) {
    for (const [key, value] of Object.entries(source)) {
      if (typeof value === "string" && value.trim()) out[key] = value.trim();
    }
  }
  return out;
}

function phoneEntries(phone: string | null | undefined, keys: { mobile: string; fixe: string }): Record<string, string> {
  if (!phone?.trim()) return {};
  return { [isFrenchMobile(phone) ? keys.mobile : keys.fixe]: phone.trim() };
}

// ── Sources structurées → clés demandeur ────────────────────────────────────

/**
 * Valeurs demandeur Socle depuis les données structurées du courrier.
 * Priorité usager lié > participant sender brut, champ par champ.
 */
export function usagerToSocleRequester(
  usager: Usager | null,
  participant: SenderParticipantLike | null,
): Record<string, string> {
  const fromParticipant: Record<string, string> = participant
    ? {
        ...(participant.last_name?.trim() ? { nom_naissance: participant.last_name.trim() } : {}),
        ...(participant.first_name?.trim() ? { prenoms: participant.first_name.trim() } : {}),
        ...(participant.email?.trim() ? { courriel: participant.email.trim() } : {}),
        ...(participant.address?.trim() ? { adresse: participant.address.trim() } : {}),
        ...(participant.organization?.trim() ? { raison_sociale: participant.organization.trim() } : {}),
        ...phoneEntries(participant.phone, { mobile: "tel_portable", fixe: "tel_fixe" }),
      }
    : {};

  if (!usager) return fromParticipant;

  const address = formatUsagerAddressInline(usager);
  const fromUsager: Record<string, string> = {
    ...(usager.civilite ? { civilite: usager.civilite } : {}),
    ...(usager.last_name?.trim() ? { nom_naissance: usager.last_name.trim() } : {}),
    ...((usager.usual_name ?? usager.last_name)?.trim()
      ? { nom_usuel: (usager.usual_name ?? usager.last_name)!.trim() }
      : {}),
    ...(usager.first_name?.trim() ? { prenoms: usager.first_name.trim() } : {}),
    ...(usager.email?.trim() ? { courriel: usager.email.trim() } : {}),
    ...(address ? { adresse: address } : {}),
    ...(usager.category !== "citoyen" && usager.last_name?.trim()
      ? { raison_sociale: usager.last_name.trim() }
      : {}),
    ...phoneEntries(usager.phone, { mobile: "tel_portable", fixe: "tel_fixe" }),
  };
  return mergeNonEmpty(fromUsager, fromParticipant);
}

/** Valeurs demandeur Arpège (codes CIVILITE/NOM_USUEL/…) depuis les mêmes sources. */
export function usagerToArpegeValues(
  usager: Usager | null,
  participant: SenderParticipantLike | null,
): Record<string, string> {
  const fromParticipant: Record<string, string> = participant
    ? {
        ...(participant.last_name?.trim() ? { NOM_USUEL: participant.last_name.trim() } : {}),
        ...(participant.first_name?.trim() ? { PRENOMS: participant.first_name.trim() } : {}),
        ...(participant.email?.trim() ? { EMAIL: participant.email.trim() } : {}),
        ...phoneEntries(participant.phone, { mobile: "TEL_MOBILE", fixe: "TEL_FIXE" }),
      }
    : {};

  if (!usager) return fromParticipant;

  const fromUsager: Record<string, string> = {
    ...(usager.civilite === "madame" ? { CIVILITE: "MME" } : usager.civilite === "monsieur" ? { CIVILITE: "M" } : {}),
    ...(usager.last_name?.trim() ? { NOM_NAISSANCE: usager.last_name.trim() } : {}),
    ...((usager.usual_name ?? usager.last_name)?.trim()
      ? { NOM_USUEL: (usager.usual_name ?? usager.last_name)!.trim() }
      : {}),
    ...(usager.first_name?.trim() ? { PRENOMS: usager.first_name.trim() } : {}),
    ...(usager.birth_date ? { DATE_NAISSANCE: usager.birth_date } : {}),
    ...(usager.email?.trim() ? { EMAIL: usager.email.trim() } : {}),
    ...phoneEntries(usager.phone, { mobile: "TEL_MOBILE", fixe: "TEL_FIXE" }),
  };
  return mergeNonEmpty(fromUsager, fromParticipant);
}

/** Convertit le prefill LLM historique (clés Arpège) vers les clés demandeur Socle. */
export function arpegePrefillToSocleRequester(prefill: ArpegePrefill | null | undefined): Record<string, string> {
  if (!prefill) return {};
  const out: Record<string, string> = {};
  const set = (key: string, value: string | undefined) => {
    if (value?.trim()) out[key] = value.trim();
  };
  if (prefill.CIVILITE === "M") out.civilite = "monsieur";
  else if (prefill.CIVILITE === "MME" || prefill.CIVILITE === "MLLE") out.civilite = "madame";
  set("nom_naissance", prefill.NOM_NAISSANCE);
  set("nom_usuel", prefill.NOM_USUEL);
  set("prenoms", prefill.PRENOMS);
  set("courriel", prefill.EMAIL);
  set("tel_portable", prefill.TEL_MOBILE);
  set("tel_fixe", prefill.TEL_FIXE);
  return out;
}

// ── Audience ────────────────────────────────────────────────────────────────

/**
 * Public présélectionné : catégorie de l'usager lié > déduction LLM > premier
 * public activé. Une candidate absente des publics activés est ignorée.
 */
export function resolveAudience(
  enabled: Audience[],
  usagerCategory?: string | null,
  llmAudience?: string | null,
): Audience | null {
  for (const candidate of [usagerCategory, llmAudience]) {
    if (candidate && (enabled as string[]).includes(candidate)) return candidate as Audience;
  }
  return enabled[0] ?? null;
}

// ── Application du préremplissage au form_schema ────────────────────────────

/** Clé de contrat d'un champ : `key`, ou `id` si key vide (même règle que l'edge). */
function prefillKeyOf(field: SocleField): string {
  return field.key.trim() || field.id;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const NUMBER_RE = /^-?\d+(?:[.,]\d+)?$/;

function validatedValue(field: SocleField, raw: unknown): unknown | undefined {
  switch (field.type) {
    case "select":
    case "radio":
      return typeof raw === "string" && field.options.some((o) => o.value === raw) ? raw : undefined;
    case "checkboxes": {
      if (!Array.isArray(raw)) return undefined;
      const valid = new Set(field.options.map((o) => o.value));
      const values = raw.filter((v): v is string => typeof v === "string" && valid.has(v));
      return values.length > 0 ? values : undefined;
    }
    case "boolean":
      return raw === true || raw === "true" ? true : undefined;
    case "date":
      return typeof raw === "string" && DATE_RE.test(raw.trim()) ? raw.trim() : undefined;
    case "number":
      return typeof raw === "string" && NUMBER_RE.test(raw.trim())
        ? raw.trim().replace(",", ".")
        : undefined;
    case "attachment":
      return undefined;
    default:
      return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
  }
}

/**
 * Convertit un préremplissage indexé par clé de champ (contrat stocké dans
 * l'analyse) en `FormValues` indexé par id, contre le schéma COURANT de la
 * démarche : les clés disparues et les valeurs devenues invalides (option
 * supprimée…) sont ignorées. Absorbe la dérive de schéma entre l'analyse
 * (sync nocturne) et l'ouverture du dialogue.
 */
export function applySocleFormPrefill(
  schema: SocleFormSchema,
  byKey: Record<string, unknown> | null | undefined,
): FormValues {
  const out: FormValues = {};
  if (!byKey) return out;
  const allFields: SocleField[] = [];
  for (const node of schema.content) {
    if (isSection(node)) allFields.push(...node.fields);
    else allFields.push(node);
  }
  for (const field of allFields) {
    const key = prefillKeyOf(field);
    if (!(key in byKey)) continue;
    const value = validatedValue(field, byKey[key]);
    if (value !== undefined) out[field.id] = value;
  }
  return out;
}
