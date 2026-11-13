// Logique pure (testable en Vitest) du COURRIER DE RÉPONSE déposé par Iris
// (porte `iris-reply-courier`, 2026-11-12). Aucune dépendance Deno ni Supabase.
//
// Une démarche du Socle peut exiger que ses courriers de réponse passent par le
// circuit du courrier sortant de Clara (Socle `communication_config.replyLetters`,
// 1.46.0). L'agent d'Iris rédige le courrier ; Iris le dépose ici, de serveur à
// serveur. Clara le range en COURRIER SORTANT à l'état initial du workflow de
// réponse de l'organisation, lié à la demande Iris (`couriers.iris_*`). Quand le
// courrier part — ou est abandonné —, la file `iris_reply_notifications` prévient
// Iris (`notify-iris-reply`), qui clôt la demande avec l'issue choisie par son
// agent. Clara ne décide jamais du statut de la demande : elle transmet un fait.

import { isUuid } from "./portalIntakeLogic.ts";

export const IRIS_REPLY_SUBJECT_MAX = 300;
export const IRIS_REPLY_BODY_MAX = 50_000;

export type IrisReplyChannel = "email" | "paper";

export interface IrisReplyPayload {
  submissionId: string;
  socleOrganizationId: string;
  socleContactId: string;
  channel: IrisReplyChannel;
  subject: string;
  bodyText: string;
  irisRequest: { id: string; reference: string; url: string | null };
  submittedBy: { name: string | null; email: string | null };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed.slice(0, max);
}

/** Valide le dépôt d'Iris. Rend un message français (champ nommé) en cas de refus. */
export function parseIrisReplyPayload(raw: unknown): IrisReplyPayload | { error: string } {
  if (!isRecord(raw)) return { error: "Corps JSON attendu" };
  if (!isUuid(raw.submission_id)) return { error: "Identifiant de dépôt invalide" };
  if (!isUuid(raw.socle_organization_id)) return { error: "Organisme émetteur invalide" };
  if (!isUuid(raw.socle_contact_id)) return { error: "Destinataire : fiche du référentiel requise" };
  if (raw.channel !== "email" && raw.channel !== "paper") return { error: "Canal : courriel ou papier" };

  const subject = typeof raw.subject === "string" ? raw.subject.trim() : "";
  const bodyText = typeof raw.body_text === "string" ? raw.body_text.trim() : "";
  if (!subject) return { error: "L'objet du courrier est obligatoire" };
  if (subject.length > IRIS_REPLY_SUBJECT_MAX) return { error: "Objet trop long" };
  if (!bodyText) return { error: "Le texte du courrier est obligatoire" };
  if (bodyText.length > IRIS_REPLY_BODY_MAX) return { error: "Texte du courrier trop long" };

  const req = isRecord(raw.iris_request) ? raw.iris_request : null;
  if (!req || !isUuid(req.id)) return { error: "Demande Iris invalide" };
  const reference = str(req.reference, 64);
  if (!reference) return { error: "Référence de la demande Iris manquante" };
  const url = typeof req.url === "string" && /^https:\/\//.test(req.url) ? req.url.slice(0, 500) : null;

  const by = isRecord(raw.submitted_by) ? raw.submitted_by : {};
  return {
    submissionId: raw.submission_id as string,
    socleOrganizationId: raw.socle_organization_id as string,
    socleContactId: raw.socle_contact_id as string,
    channel: raw.channel,
    subject,
    bodyText,
    irisRequest: { id: req.id as string, reference, url },
    submittedBy: { name: str(by.name, 200), email: str(by.email, 320) },
  };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Texte brut de l'agent → HTML de l'éditeur de réponse : un paragraphe par bloc
 * séparé d'une ligne vide, retours à la ligne conservés. Tout est échappé —
 * aucun balisage venu d'Iris n'entre tel quel.
 */
export function irisReplyBodyHtml(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block !== "")
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/** URL de la fiche d'un courrier dans Clara (`https` seulement), ou `null`. */
export function claraCourierUrl(appUrl: string | null | undefined, courierId: string): string | null {
  const base = (appUrl ?? "").replace(/\/+$/, "");
  return /^https:\/\//.test(base) ? `${base}/courrier/${courierId}` : null;
}

// ─── Avis à Iris ──────────────────────────────────────────────────────────────

export type IrisReplyEvent = "sent" | "cancelled";

/**
 * Le courrier tel qu'il est PARTI, joint à l'avis `sent` (contrat Iris 2.13.0,
 * décision PO Iris du 2026-11-13) : Iris en garde la trace — un échange de la
 * demande et, pour le papier, le PDF au dossier.
 */
export interface IrisReplyLetter {
  channel: IrisReplyChannel;
  subject: string;
  body: string;
  recipient: string | null;
  document?: { file_name: string; content_base64: string };
}

export interface SentCourierFacts {
  channel: string | null;
  subject: string | null;
  metadata: Record<string, unknown> | null;
  /** Participant « recipient » du sortant. */
  recipient: { email: string | null; name: string | null } | null;
}

/** HTML de l'éditeur → texte brut (images en ligne, dont la signature, écartées). */
export function irisLetterText(html: string): string {
  return html
    .replace(/<img\b[^>]*>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Le canal RÉELLEMENT utilisé : la marque d'envoi fait foi (`sent_email_at` →
 * courriel, `posted_at` → papier), le canal prévu ne sert qu'à défaut.
 */
export function irisLetterChannel(facts: SentCourierFacts): IrisReplyChannel {
  const meta = facts.metadata ?? {};
  if (meta.sent_email_at) return "email";
  if (meta.posted_at) return "paper";
  return facts.channel === "email" ? "email" : "paper";
}

/**
 * Le `letter` d'un courrier parti, sans le PDF (ajouté par l'appelant, qui
 * lit le stockage). `null` si rien d'exploitable : l'avis part alors sans
 * trace plutôt que d'être refusé par Iris.
 */
export function irisReplyLetter(facts: SentCourierFacts): IrisReplyLetter | null {
  const meta = facts.metadata ?? {};
  const html = typeof meta.body_html === "string" ? meta.body_html : "";
  const fallback = typeof meta.body_text === "string" ? meta.body_text.trim() : "";
  const body = (html ? irisLetterText(html) : "") || fallback;
  const subject = (facts.subject ?? "").trim() || "Réponse à votre demande";
  if (body === "") return null;
  const channel = irisLetterChannel(facts);
  const recipient = channel === "email"
    ? (facts.recipient?.email ?? null)
    : (facts.recipient?.name ?? facts.recipient?.email ?? null);
  return {
    channel,
    subject: subject.slice(0, 300),
    body: body.slice(0, 50_000),
    recipient: recipient ? recipient.trim().slice(0, 320) || null : null,
  };
}

/** Le PDF joint à l'avis ne dépasse pas ce que le contrat Iris accepte (10 Mo). */
export const IRIS_LETTER_PDF_MAX_BYTES = 10 * 1_048_576;

type IrisReplyEventPayload = {
  courier_id: string;
  event: IrisReplyEvent;
  occurred_at?: string;
  letter?: IrisReplyLetter;
};

/**
 * Corps de `POST /v1/requests/{id}/reply-letter/events` (contrat Iris 2.12.0 ;
 * `letter` depuis 2.13.0, avec `sent` seulement).
 */
export function irisReplyEventBody(
  courierId: string,
  event: IrisReplyEvent,
  occurredAt: string | null,
  letter: IrisReplyLetter | null = null,
): IrisReplyEventPayload {
  const body: IrisReplyEventPayload = occurredAt
    ? { courier_id: courierId, event, occurred_at: occurredAt }
    : { courier_id: courierId, event };
  if (event === "sent" && letter) body.letter = letter;
  return body;
}

export type IrisNotifyOutcome = "delivered" | "rejected" | "retry";

/**
 * Lecture de la réponse d'Iris :
 *  - 200 → livré (y compris un rejeu : `already`) ;
 *  - 404 / 409 / 400 / 403 → refus DÉFINITIF : relancer ne changerait rien
 *    (demande hors tenant, courrier qui n'est plus celui attendu, contrat) ;
 *  - 401, 5xx, réseau → nouvel essai plus tard.
 */
export function irisNotifyOutcome(status: number | null): IrisNotifyOutcome {
  if (status === null) return "retry";
  if (status >= 200 && status < 300) return "delivered";
  if (status === 400 || status === 403 || status === 404 || status === 409 || status === 422) return "rejected";
  return "retry";
}

/** Délai avant le prochain essai : 1, 2, 5, 15, 30 min, puis toutes les heures. */
export function irisNotifyBackoffMinutes(attempts: number): number {
  const steps = [1, 2, 5, 15, 30];
  return attempts < steps.length ? steps[Math.max(0, attempts)] : 60;
}

/** Au-delà, l'avis est abandonné (`failed`) — l'agent Iris peut toujours relancer côté Clara. */
export const IRIS_NOTIFY_MAX_ATTEMPTS = 48;
