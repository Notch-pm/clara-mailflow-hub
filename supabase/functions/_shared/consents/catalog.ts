/**
 * Catalogue des consentements RGPD demandés à l'usager — repris à l'identique
 * d'Iris (`supabase/functions/_shared/consents/catalog.ts`), parce que le
 * référentiel Socle ne connaît que ces deux finalités et que la gamme pose la
 * même question partout. Logique pure, sans dépendance Deno : importée par les
 * edge functions (garde serveur, composition du libellé consigné) ET par le
 * navigateur (`src/lib/consents.ts`), pour que l'écran affiche EXACTEMENT la
 * phrase qui sera enregistrée.
 *
 * Dans Clara, la question est posée à deux endroits :
 *  - au formulaire portail public (`portal-form`), où l'usager est présent :
 *    `traitement` y est OBLIGATOIRE, garde `normalizeConsents` ;
 *  - à la consignation manuelle par un agent (formulaire papier, retrait),
 *    où le Socle enregistre un fait sans rien exiger — `normalizeConsents`
 *    n'y sert PAS (elle refuserait précisément un retrait de `traitement`).
 *
 * ⚠️ Le navigateur n'envoie JAMAIS le libellé : il n'envoie que `kind` et
 * `granted`. La phrase consignée est recomposée ICI, côté serveur, depuis le
 * nom de l'organisation relu en base (`organizations.name`, miroir du nom de
 * la racine Socle) — même doctrine que les snapshots.
 */

/** Les deux consentements du catalogue. Aucun autre n'existe. */
export type ConsentKind = "traitement" | "partage";

export interface ConsentDef {
  kind: ConsentKind;
  /** Sans lui, un dépôt portail ne peut pas être validé (garde serveur, pas seulement UI). */
  required: boolean;
  /** État de la case à l'ouverture du formulaire. */
  defaultGranted: boolean;
  /** Libellé court : en-tête de colonne, badge de fiche. */
  label: string;
  /** Ce que le consentement autorise, en une ligne, pour l'agent qui lit la fiche. */
  purpose: string;
}

/**
 * Nom d'organisme de repli. Le libellé doit TOUJOURS être composable : une
 * phrase à trou (« aux services de  ») serait consignée telle quelle et
 * resterait au dossier pour des années.
 */
export const DEFAULT_ORGANISM = "la collectivité";

export const CONSENTS: readonly ConsentDef[] = [
  {
    kind: "traitement",
    required: true,
    defaultGranted: false,
    label: "Traitement de la demande",
    purpose: "Utiliser les informations fournies pour instruire cette demande.",
  },
  {
    kind: "partage",
    required: false,
    defaultGranted: true,
    label: "Partage aux services",
    purpose:
      "Partager ces informations aux services de la collectivité pour améliorer le traitement de cette demande et des suivantes.",
  },
];

const BY_KIND = new Map<string, ConsentDef>(CONSENTS.map((c) => [c.kind, c]));

export function consentDef(kind: string): ConsentDef | null {
  return BY_KIND.get(kind) ?? null;
}

export function isConsentKind(value: unknown): value is ConsentKind {
  return typeof value === "string" && BY_KIND.has(value);
}

/** Nom d'organisme propre, replié sur `DEFAULT_ORGANISM` si vide ou absent. */
export function organismLabel(name: string | null | undefined): string {
  const trimmed = typeof name === "string" ? name.trim() : "";
  return trimmed === "" ? DEFAULT_ORGANISM : trimmed;
}

/**
 * Phrase EXACTE soumise à l'usager, et consignée telle quelle : c'est elle qui
 * fait la preuve du consentement (art. 7.1 RGPD), pas le booléen. Le nom de
 * l'organisation y est interpolé — une même collectivité ne pose donc pas la
 * même phrase qu'une autre, et l'historique garde celle du jour du recueil
 * même si la collectivité est renommée ensuite.
 */
export function consentStatement(kind: ConsentKind, organismName?: string | null): string {
  if (kind === "traitement") {
    return "J'accepte que les informations fournies ici soient utilisées dans le cadre du traitement de ma demande.";
  }
  return `J'accepte de partager ces informations aux services de ${organismLabel(organismName)} `
    + "afin d'améliorer le traitement de ma demande et de mes futures demandes.";
}

/**
 * Un consentement recueilli : ce qui est consigné sur le courrier et au
 * référentiel. `collected_at` est propre à Clara : la trace d'un dépôt portail
 * porte sa date, pour que le report au Socle consigne la date du recueil et
 * non celle du rattachement (qui peut venir des jours plus tard).
 */
export interface ConsentRecord {
  kind: ConsentKind;
  granted: boolean;
  /** Libellé soumis à l'usager, recomposé côté serveur. */
  statement: string;
  /** Date du recueil (ISO), quand la trace la porte. */
  collected_at?: string;
}

/** État initial du formulaire : `traitement` décoché, `partage` coché. */
export function defaultConsentAnswers(): Record<ConsentKind, boolean> {
  const out = {} as Record<ConsentKind, boolean>;
  for (const c of CONSENTS) out[c.kind] = c.defaultGranted;
  return out;
}

/** Le dépôt est-il validable ? (reflet d'écran — la garde vit dans `normalizeConsents`) */
export function consentsSatisfied(answers: Partial<Record<ConsentKind, boolean>>): boolean {
  return CONSENTS.every((c) => !c.required || answers[c.kind] === true);
}

export type ConsentParse =
  | { ok: true; consents: ConsentRecord[] }
  | { ok: false; message: string };

/**
 * Garde serveur du DÉPÔT (formulaire portail). Entrée acceptée :
 * `[{ kind, granted }]` — tout le reste est refusé, le libellé compris (il se
 * compose ici, jamais ailleurs).
 *
 * Refuse : forme invalide, `kind` hors catalogue, doublon, consentement
 * OBLIGATOIRE absent ou refusé. Un `kind` du catalogue non transmis et non
 * obligatoire vaut « non accordé » — l'absence de case cochée est un refus,
 * jamais un défaut silencieux (le défaut `coché` est une commodité d'écran,
 * pas une présomption de consentement).
 */
export function normalizeConsents(raw: unknown, organismName?: string | null): ConsentParse {
  if (raw === undefined || raw === null) {
    return { ok: false, message: "consents : tableau des consentements requis." };
  }
  if (!Array.isArray(raw)) return { ok: false, message: "consents : tableau attendu." };
  if (raw.length > CONSENTS.length) {
    return { ok: false, message: "consents : plus de consentements que le catalogue n'en compte." };
  }

  const answers = new Map<ConsentKind, boolean>();
  for (const [i, entry] of raw.entries()) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return { ok: false, message: `consents[${i}] : objet attendu.` };
    }
    const row = entry as Record<string, unknown>;
    const unknown = Object.keys(row).filter((k) => k !== "kind" && k !== "granted");
    if (unknown.length > 0) {
      return {
        ok: false,
        message: `consents[${i}] : seules les clés kind et granted sont acceptées `
          + `(${unknown.join(", ")} refusée${unknown.length > 1 ? "s" : ""} — le libellé est composé par le serveur).`,
      };
    }
    if (!isConsentKind(row.kind)) {
      return { ok: false, message: `consents[${i}].kind : valeur hors catalogue.` };
    }
    if (typeof row.granted !== "boolean") {
      return { ok: false, message: `consents[${i}].granted : booléen attendu.` };
    }
    if (answers.has(row.kind)) {
      return { ok: false, message: `consents[${i}].kind : ${row.kind} transmis deux fois.` };
    }
    answers.set(row.kind, row.granted);
  }

  const consents: ConsentRecord[] = [];
  for (const def of CONSENTS) {
    const granted = answers.get(def.kind) ?? false;
    if (def.required && !granted) {
      return {
        ok: false,
        message: "Le consentement à l'utilisation des informations pour le traitement de la demande "
          + "est obligatoire : sans lui, le dépôt ne peut pas être validé.",
      };
    }
    consents.push({ kind: def.kind, granted, statement: consentStatement(def.kind, organismName) });
  }
  return { ok: true, consents };
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * Consentements tels qu'ils sont relus sur un courrier — tolérant : une trace
 * écrite par une version antérieure ne doit jamais faire tomber un écran.
 * `collected_at` n'est conservé que s'il est une date ISO lisible.
 */
export function parseConsentRecords(raw: unknown): ConsentRecord[] {
  if (!Array.isArray(raw)) return [];
  const out: ConsentRecord[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const row = entry as Record<string, unknown>;
    if (!isConsentKind(row.kind) || seen.has(row.kind)) continue;
    seen.add(row.kind);
    const record: ConsentRecord = {
      kind: row.kind,
      granted: row.granted === true,
      statement: typeof row.statement === "string" && row.statement.trim() !== ""
        ? row.statement.trim()
        : consentStatement(row.kind),
    };
    if (typeof row.collected_at === "string" && ISO_DATE_RE.test(row.collected_at)
      && !Number.isNaN(Date.parse(row.collected_at))) {
      record.collected_at = row.collected_at;
    }
    out.push(record);
  }
  // Ordre du CATALOGUE, jamais celui de la donnée : l'obligatoire d'abord.
  return CONSENTS.map((c) => out.find((r) => r.kind === c.kind)).filter((r): r is ConsentRecord => r !== undefined);
}
