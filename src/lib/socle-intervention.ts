// Bloc « Lieu d'intervention » d'une démarche — reconnaissance PURE, testée.
//
// Le Socle propose un bloc prêt à l'emploi : une **section ordinaire** du
// `form_schema` (aucun type dédié dans le contrat), pré-remplie de champs dont
// les clés machine sont préfixées `intervention_`. Tout y reste modifiable
// après insertion : on reconnaît donc le bloc d'abord par ses **clés** (la
// donnée du contrat), puis, à défaut, par le **titre** de la section et les
// libellés de ses champs.
//
// Rien de tout cela n'est une garde : cette reconnaissance ne décide que d'un
// AFFICHAGE — une adresse saisie d'un seul tenant, avec sa carte, au lieu de
// sept champs séparés. Ce qui part dans la demande reste ce que la démarche a
// posé, champ par champ.
//
// Porté d'Iris (`src/features/requests/instruction/lieu.ts`) pour que les deux
// produits reconnaissent le MÊME bloc : ce que Clara saisit ici, Iris doit le
// relire comme une adresse.

import { isSection, type SocleField, type SocleFormSchema, type SocleSection } from "./socle-form";

const PARTS = [
  "numero",
  "btq",
  "voie",
  "batiment",
  "complement",
  "appartement",
  "code_postal",
  "ville",
] as const;
export type AddressPart = (typeof PARTS)[number];

/** Clés machine posées par le bloc « Lieu d'intervention » du Socle. */
const KEY_BY_PART: Record<AddressPart, string> = {
  numero: "intervention_numero",
  btq: "intervention_btq",
  voie: "intervention_voie",
  batiment: "intervention_batiment",
  complement: "intervention_complement",
  appartement: "intervention_appartement",
  code_postal: "intervention_code_postal",
  ville: "intervention_ville",
};

const PART_BY_KEY = new Map<string, AddressPart>(
  PARTS.map((part) => [KEY_BY_PART[part], part] as const),
);

/** Libellés du bloc Socle — repli quand les clés ont été renommées. */
const PART_BY_LABEL = new Map<string, AddressPart>([
  ["numero", "numero"],
  ["n", "numero"],
  ["numero de voie", "numero"],
  ["btq", "btq"],
  ["bis ter quater", "btq"],
  ["voie", "voie"],
  ["rue", "voie"],
  ["nom de la voie", "voie"],
  ["batiment", "batiment"],
  ["bat", "batiment"],
  ["immeuble", "batiment"],
  ["complement d adresse", "complement"],
  ["complement", "complement"],
  ["appartement", "appartement"],
  ["code postal", "code_postal"],
  ["ville", "ville"],
  ["commune", "ville"],
]);

const SECTION_TITLE = "lieu d intervention";

/** « Complément d'adresse » → « complement d adresse ». */
function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Un champ du schéma, et la section qui le porte (`null` à la racine). */
export interface FlatField {
  field: SocleField;
  section: SocleSection | null;
}

/** Tous les champs du schéma, à plat, sans perdre leur section. */
export function flattenSocleFields(schema: SocleFormSchema): FlatField[] {
  const out: FlatField[] = [];
  for (const node of schema.content) {
    if (isSection(node)) {
      for (const field of node.fields) out.push({ field, section: node });
    } else {
      out.push({ field: node, section: null });
    }
  }
  return out;
}

/** Section portant les champs reconnus (la première rencontrée fait foi). */
function sectionOf(found: Map<AddressPart, FlatField>): SocleSection | null {
  for (const part of PARTS) {
    const section = found.get(part)?.section;
    if (section) return section;
  }
  return null;
}

function titledSection(schema: SocleFormSchema): SocleSection | null {
  for (const node of schema.content) {
    if (isSection(node) && normalize(node.title).startsWith(SECTION_TITLE)) return node;
  }
  return null;
}

/**
 * Reconnaissance du bloc — l'unique endroit où l'on décide « ce champ-là porte
 * le numéro, celui-ci la voie ».
 *
 * `null` quand rien ne ressemble à une adresse : ni voie, ni commune, ni code
 * postal. Le formulaire retombe alors sur le rendu ordinaire, champ par champ.
 */
export function interventionFields(
  schema: SocleFormSchema,
  candidates: FlatField[] = flattenSocleFields(schema),
): Map<AddressPart, FlatField> | null {
  const found = new Map<AddressPart, FlatField>();
  const used = new Set<string>();

  // 1. Par clé machine, où que le champ se trouve dans le formulaire.
  for (const entry of candidates) {
    const part = PART_BY_KEY.get(entry.field.key);
    if (part && !found.has(part)) {
      found.set(part, entry);
      used.add(entry.field.id);
    }
  }

  // 2. Par section : celle des champs reconnus, sinon celle titrée « Lieu
  //    d'intervention ». Ses champs comblent les parts manquantes par libellé
  //    (clés renommées dans le Socle après insertion du bloc).
  const section = sectionOf(found) ?? titledSection(schema);
  if (section) {
    for (const entry of candidates) {
      if (entry.section !== section || used.has(entry.field.id)) continue;
      const part = PART_BY_LABEL.get(normalize(entry.field.label));
      if (part && !found.has(part)) {
        found.set(part, entry);
        used.add(entry.field.id);
      }
    }
  }

  // Ni voie ni commune : ce n'est pas une adresse — pas de bloc.
  if (!found.has("voie") && !found.has("ville") && !found.has("code_postal")) return null;
  return found;
}

/**
 * Le bloc n'est repris en champ d'adresse que s'il tient dans UNE section : un
 * champ posé hors d'elle serait masqué sans être remplacé, et on perdrait une
 * question que la démarche pose. Éparpillé à la racine, le rendu ordinaire
 * reste plus honnête que de regrouper des champs qu'elle n'a pas voulus
 * ensemble.
 */
export interface InterventionBlock {
  section: SocleSection;
  fields: Map<AddressPart, FlatField>;
  /** Ids rendus par le bloc — à ne pas répéter en champs séparés. */
  ids: Set<string>;
}

export function interventionBlock(schema: SocleFormSchema): InterventionBlock | null {
  const fields = interventionFields(schema);
  if (!fields) return null;
  const entries = [...fields.values()];
  const section = entries[0]?.section ?? null;
  if (!section) return null;
  if (entries.some((entry) => entry.section !== section)) return null;
  return { section, fields, ids: new Set(entries.map((entry) => entry.field.id)) };
}

export interface StreetParts {
  numero: string;
  btq: string;
  voie: string;
}

/**
 * Répartit une ligne de voie sur les champs QUE LE BLOC PORTE RÉELLEMENT.
 *
 * Le bloc du Socle se retaille après insertion : il peut n'avoir ni numéro ni
 * BTQ, et son BTQ est souvent une liste fermée (bis / ter / quater) qui ne sait
 * pas dire « A ». Ce qu'aucun champ ne peut porter rejoint la **voie** au lieu
 * d'être perdu : une adresse un peu tassée reste une adresse, un numéro effacé
 * n'en est plus une.
 */
export function fitStreetParts(
  parts: StreetParts,
  available: (part: AddressPart) => boolean,
  coerceBtq: (text: string) => string | null,
): StreetParts {
  const head: string[] = [];
  let numero = parts.numero.trim();
  let btq = parts.btq.trim();

  if (btq !== "") {
    const option = available("btq") ? coerceBtq(btq) : null;
    if (option === null) {
      head.push(btq);
      btq = "";
    } else {
      btq = option;
    }
  }
  if (numero !== "" && !available("numero")) {
    head.unshift(numero);
    numero = "";
  }
  return {
    numero,
    btq,
    voie: [...head, parts.voie.trim()].filter((v) => v !== "").join(" "),
  };
}

function fold(value: string): string {
  return value.trim().normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/**
 * Valeur d'option correspondant à un texte libre — « bis » vers l'option `bis`
 * du champ BTQ, quelle que soit la casse ou les accents. `null` quand le champ
 * ne sait PAS représenter ce texte : l'appelant décide alors quoi en faire
 * plutôt que d'écrire une valeur que la démarche refuserait. Un champ sans
 * options accepte le texte tel quel.
 */
export function optionValueFor(field: SocleField, text: string): string | null {
  const value = text.trim();
  if (value === "") return "";
  if (field.type !== "select" && field.type !== "radio") return value;
  const wanted = fold(value);
  const match = field.options.find((o) => fold(o.value) === wanted || fold(o.label) === wanted);
  return match ? match.value : null;
}

/** Valeur lisible d'un champ : le libellé d'une option, à défaut le texte. */
export function displayFieldValue(field: SocleField, value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  if (field.type === "boolean") return value === true ? "Oui" : "Non";
  if (field.type === "select" || field.type === "radio") {
    return field.options.find((o) => o.value === value)?.label ?? String(value);
  }
  if (field.type === "checkboxes" && Array.isArray(value)) {
    return value.map((v) => field.options.find((o) => o.value === v)?.label ?? String(v)).join(", ");
  }
  return String(value);
}
