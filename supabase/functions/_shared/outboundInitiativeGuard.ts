// Quand une organisation peut-elle émettre un courrier à son initiative ?
// LOGIQUE PURE (aucune dépendance Deno), partagée par l'écran (choix de
// l'organisation émettrice) et testée par vitest.
//
// ⚠️ LA FONCTION `outbound_initiative_block_reason` et le trigger
// `couriers_enforce_outbound_initiative` (migration
// 20261013114800_sortants_initiative.sql) appliquent la même règle en base,
// pour tout appelant, avec les MÊMES messages. Changer l'un sans l'autre ferait
// dire à l'écran autre chose que ce que la base refuse.

export const NO_ISSUER_REASON = "Choisissez l'organisation qui émet ce courrier.";

export const FOREIGN_ISSUER_REASON = "Cette organisation n'appartient pas à votre collectivité.";

export const OUTBOUND_CHANNEL_REASON = "Un courrier sortant part par courriel ou par courrier postal.";

export const LOCKED_ISSUER_REASON =
  "Courrier déjà visé, signé ou envoyé : son organisation émettrice et son mode d'envoi ne changent plus.";

export const ISSUER_NOT_AT_INITIAL_REASON =
  "On ne change d'organisation émettrice qu'à l'état initial du workflow.";

export function obsoleteIssuerReason(name: string): string {
  return `L'organisation « ${name} » n'est plus active : choisissez-en une autre.`;
}

export function noReplyWorkflowReason(name: string): string {
  return `Aucun workflow de réponse n'est configuré pour l'organisation « ${name} ». Un administrateur doit le rattacher.`;
}

export interface IssuerCandidate {
  name: string;
  status?: string | null;
  obsoleted_at?: string | null;
  reply_workflow_id: string | null;
}

/**
 * Pourquoi cette organisation ne peut pas émettre de courrier, ou `null`.
 * L'écran grise l'organisation avec ce motif plutôt que de la cacher : un
 * agent qui ne voit pas son service doit savoir qu'il manque un réglage.
 */
export function issuerBlockReason(org: IssuerCandidate | null | undefined): string | null {
  if (!org) return NO_ISSUER_REASON;
  if (org.status === "obsolete" || org.obsoleted_at) return obsoleteIssuerReason(org.name);
  if (!org.reply_workflow_id) return noReplyWorkflowReason(org.name);
  return null;
}

export const UNSENT_EMAIL_CLOSE_REASON =
  "Ce courriel n'est pas encore parti : envoyez-le avant de le clore (ou abandonnez-le).";

export const UNPOSTED_LETTER_CLOSE_REASON =
  "Ce courrier n'a pas encore été posté : déclarez-le « posté » avant de le clore (ou abandonnez-le).";

export const POSTED_DATE_REASON =
  "La date d'envoi ne peut être ni dans le futur, ni antérieure à la création du courrier.";
