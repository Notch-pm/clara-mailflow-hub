// Mentions obligatoires de l'accusé de réception d'une demande adressée à
// l'administration (art. L112-3 et R112-5 du code des relations entre le public
// et l'administration — CRPA).
// AUCUN import Deno ici : ce module est lu par l'écran de rédaction
// (`ReplyComposer`, la liste de contrôle sous l'éditeur), par l'edge function
// `draft-reply` (le bloc du prompt) ET par les tests Vitest
// (src/test/socle/draft-reply-acknowledgment.test.ts).
//
// ⚠️ L'ENJEU N'EST PAS DE FORME. Un accusé de réception incomplet rend les
// délais de recours INOPPOSABLES au demandeur (art. L112-6 CRPA) : la décision
// implicite de rejet reste contestable sans limite de temps. D'où une seule
// liste, partagée : l'agent voit à l'écran exactement ce que l'assistant IA a
// reçu l'ordre d'écrire.
//
// Ce que Clara ne sait PAS, l'agent le dit : le sens du silence (acceptation
// ou rejet) et son délai dépendent de la démarche, avec de nombreuses
// exceptions au principe « silence vaut acceptation » (art. L231-1, L231-4,
// L231-5 et décrets). Rien n'est déduit ; à défaut, l'assistant écrit
// [à compléter : …].

// ── Liste de contrôle (écran) ───────────────────────────────────────────────

export interface AckMention {
  key: "dates" | "service" | "pieces" | "silence";
  label: string;
  detail: string;
}

export const ACK_MENTIONS: readonly AckMention[] = [
  {
    key: "dates",
    label: "Les dates",
    detail:
      "La date de réception de la demande, et la date à laquelle, faute de réponse expresse, la demande sera réputée acceptée ou rejetée — la date de naissance de la décision implicite, pas seulement le délai.",
  },
  {
    key: "service",
    label: "Le service chargé du dossier",
    detail: "Sa désignation, son adresse postale, le cas échéant son adresse électronique, et son numéro de téléphone.",
  },
  {
    key: "pieces",
    label: "Les pièces manquantes, s'il y en a",
    detail:
      "La liste des pièces ou informations à fournir et le délai laissé pour les produire (art. L114-5) ; le délai de décision implicite ne court qu'à compter de leur réception.",
  },
  {
    key: "silence",
    label: "Le sens du silence",
    detail:
      "Rejet implicite : les délais et voies de recours contre cette décision. Acceptation implicite : la possibilité d'obtenir l'attestation prévue à l'article L232-3.",
  },
] as const;

export const ACK_LEGAL_REFERENCE = "art. R112-5 CRPA";

// ── Saisie de l'agent ───────────────────────────────────────────────────────

export type SilenceMeaning = "acceptation" | "rejet";

/** Ce que l'agent précise pour l'accusé de réception ; tout est facultatif. */
export interface AckDetails {
  silence?: SilenceMeaning | null;
  /** Date de naissance de la décision implicite, `AAAA-MM-JJ`. */
  implicitDecisionDate?: string | null;
  /** Pièces ou informations manquantes, en texte libre (une par ligne). */
  missingPieces?: string | null;
  /** Délai laissé pour les produire, en texte libre (« 15 jours », « avant le 30 novembre »). */
  missingPiecesDeadline?: string | null;
}

export const ACK_FIELD_MAX_CHARS = 1_000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim().slice(0, ACK_FIELD_MAX_CHARS);
  return t || null;
}

/** Ce qui arrive du navigateur est relu : une valeur inattendue vaut « non précisé ». */
export function normalizeAckDetails(raw: unknown): AckDetails {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const silence = r.silence === "acceptation" || r.silence === "rejet" ? r.silence : null;
  const date = typeof r.implicitDecisionDate === "string" && ISO_DAY.test(r.implicitDecisionDate) &&
      formatIsoDayFr(r.implicitDecisionDate)
    ? r.implicitDecisionDate
    : null;
  return {
    silence,
    implicitDecisionDate: date,
    missingPieces: cleanText(r.missingPieces),
    missingPiecesDeadline: cleanText(r.missingPiecesDeadline),
  };
}

// ── Dates ───────────────────────────────────────────────────────────────────

/** `AAAA-MM-JJ` → « 12 décembre 2026 », sans décalage de fuseau ; `null` si invalide. */
export function formatIsoDayFr(day: string | null | undefined): string | null {
  if (!day || !ISO_DAY.test(day)) return null;
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

/** Délai de droit commun avant décision implicite (art. L231-1 et L231-4 CRPA). */
export const DEFAULT_SILENCE_MONTHS = 2;

/**
 * Date de naissance de la décision implicite au terme du délai de droit
 * commun : même quantième, deux mois après la réception (ramené au dernier
 * jour du mois s'il n'existe pas). Une SUGGESTION que l'agent valide : bien
 * des démarches ont un autre délai.
 */
export function defaultImplicitDecisionDate(receivedAt: string | null | undefined): string | null {
  if (!receivedAt) return null;
  const day = receivedAt.slice(0, 10);
  if (!formatIsoDayFr(day)) return null;
  const [y, m, d] = day.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + DEFAULT_SILENCE_MONTHS, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

// ── Phrases types ───────────────────────────────────────────────────────────

/**
 * Les phrases juridiques sont composées ICI, pas laissées au modèle : un
 * article mal cité ou un délai de recours approximatif est exactement ce que
 * la règle « n'invente rien » interdit, et ce que l'agent ne relirait pas.
 */
export function silenceStatement(silence: SilenceMeaning, dateLabel: string): string {
  if (silence === "acceptation") {
    return `En l'absence de réponse de notre part au ${dateLabel}, votre demande sera réputée acceptée. Vous pourrez alors obtenir, sur simple demande, une attestation de cette décision implicite d'acceptation (article L232-3 du code des relations entre le public et l'administration).`;
  }
  return `En l'absence de réponse de notre part au ${dateLabel}, votre demande sera réputée rejetée. Vous pourrez contester cette décision implicite de rejet dans un délai de deux mois à compter de cette date, par un recours gracieux auprès de nos services ou par un recours contentieux devant le tribunal administratif territorialement compétent, qui peut être saisi par l'application Télérecours citoyens (www.telerecours.fr).`;
}

// ── Bloc du prompt ──────────────────────────────────────────────────────────

export interface AckServiceContact {
  name?: string | null;
  address?: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface AckBlockInput {
  details?: AckDetails | null;
  receivedAtLabel?: string | null;
  service?: AckServiceContact | null;
}

const missing = (what: string) => `[à compléter : ${what}]`;

/**
 * Le bloc « Mentions obligatoires » du message, chaque mention avec sa valeur
 * ou son trou explicite. Le modèle n'a pas à décider ce qui est obligatoire :
 * il reçoit la liste, déjà remplie de ce que Clara et l'agent savent.
 */
export function buildAckBlock(input: AckBlockInput): string {
  const details = input.details ?? {};
  const service = input.service ?? {};
  const oneLine = (s: string | null | undefined) => (s ?? "").replace(/\s*\n\s*/g, ", ").trim();

  const lines = [
    `MENTIONS OBLIGATOIRES DE L'ACCUSÉ DE RÉCEPTION (${ACK_LEGAL_REFERENCE}) — toutes doivent figurer dans la lettre :`,
  ];

  lines.push(
    `1. Date de réception de la demande : ${(input.receivedAtLabel ?? "").trim() || missing("date de réception")}`,
  );

  const pieces = (details.missingPieces ?? "").trim();
  const dateLabel = formatIsoDayFr(details.implicitDecisionDate ?? null);
  if (pieces) {
    lines.push(
      `2. Date de naissance de la décision implicite : le délai ne court qu'à compter de la réception des pièces manquantes (article L114-5) — dis-le explicitement${
        dateLabel ? ` ; à défaut de pièces manquantes, la date aurait été le ${dateLabel}, ne la présente donc pas comme acquise` : ""
      }.`,
    );
  } else {
    lines.push(
      `2. Date à laquelle, faute de réponse expresse, la demande sera réputée ${
        details.silence === "acceptation" ? "acceptée" : details.silence === "rejet" ? "rejetée" : "acceptée ou rejetée"
      } : ${dateLabel ?? missing("date de naissance de la décision implicite")}`,
    );
  }

  lines.push(
    "3. Service chargé du dossier (désignation, adresse postale, adresse électronique, téléphone) :",
    `   - Désignation : ${oneLine(service.name) || missing("service chargé du dossier")}`,
    `   - Adresse postale : ${oneLine(service.address) || missing("adresse postale du service")}`,
    `   - Adresse électronique : ${oneLine(service.email) || missing("adresse électronique du service")}`,
    `   - Téléphone : ${oneLine(service.phone) || missing("téléphone du service")}`,
  );

  if (pieces) {
    const deadline = (details.missingPiecesDeadline ?? "").trim();
    lines.push(
      `4. Pièces ou informations manquantes (article L114-5), à lister une à une :\n${
        pieces.split(/\n+/).map((p) => `   - ${p.trim()}`).filter((p) => p !== "   -").join("\n")
      }\n   Délai pour les produire : ${deadline || missing("délai pour produire les pièces")}`,
    );
  } else {
    lines.push("4. Pièces manquantes : aucune signalée par l'agent — n'en mentionne pas.");
  }

  const statementDate = pieces
    ? "terme de ce délai"
    : dateLabel ?? missing("date de naissance de la décision implicite");
  if (details.silence) {
    lines.push(
      `5. Sens du silence : ${details.silence === "acceptation" ? "ACCEPTATION implicite" : "REJET implicite"}. Reprends en substance, sans en changer le sens, les délais ni les articles cités : « ${
        silenceStatement(details.silence, statementDate)
      } »`,
    );
  } else {
    lines.push(
      `5. Sens du silence : non précisé par l'agent. Écris ${missing("acceptation ou rejet implicite")} et, à la suite, ${missing("voies et délais de recours (rejet) ou attestation de l'article L232-3 (acceptation)")} — ne choisis pas à sa place.`,
    );
  }

  return lines.join("\n");
}
