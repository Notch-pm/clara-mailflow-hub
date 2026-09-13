// Logique pure (testable en Vitest) de fetch-inbound-emails.

/**
 * Détermine si un email entrant doit être ACCEPTÉ selon son expéditeur.
 *
 * - Boîte IMAP normale (`isScan=false`) : aucun filtre d'expéditeur → toujours accepté.
 * - Boîte de numérisation (`isScan=true`) : **FAIL-CLOSED**. N'accepte QUE les
 *   expéditeurs listés dans `allowedSenders`. Une allowlist **nulle OU vide**
 *   n'accepte RIEN : une boîte de scan n'attend que ses copieurs ; sans expéditeur
 *   configuré elle ne doit rien laisser entrer (sinon quiconque connaît l'adresse
 *   injecte des courriers dans le tenant). Un expéditeur inconnu (`null`) est refusé.
 *
 * La comparaison est insensible à la casse et aux espaces de bordure.
 */
export function isInboundSenderAccepted(
  isScan: boolean,
  allowedSenders: string[] | null | undefined,
  senderEmail: string | null | undefined,
): boolean {
  if (!isScan) return true;
  const from = (senderEmail ?? "").trim().toLowerCase();
  if (!from) return false;
  const allowed = (allowedSenders ?? [])
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(from);
}

/**
 * Texte unique du défaut de configuration « boîte de numérisation sans
 * expéditeur autorisé ». Partagé par l'edge function (bouton « Tester ») et
 * l'écran de configuration, pour qu'ils ne se contredisent plus jamais.
 */
export const SCAN_ALLOWLIST_EMPTY_MESSAGE =
  "Boîte de numérisation sans expéditeur autorisé : elle refusera TOUS les messages. " +
  "Renseignez l'adresse du copieur dans « Expéditeurs autorisés ».";

/**
 * La boîte est-elle configurée de telle sorte qu'elle ne laissera rien entrer ?
 * (le cas rencontré le 2026-09-13 : mode numérisation activé, allowlist vide)
 */
export function scanInboxAcceptsNothing(
  isScan: boolean,
  allowedSenders: string[] | null | undefined,
): boolean {
  if (!isScan) return false;
  return !(allowedSenders ?? []).some((a) => a.trim().length > 0);
}

/**
 * Message d'exploitation pour les messages refusés par l'allowlist d'une boîte
 * de numérisation.
 *
 * Sans lui, le refus est MUET : la relève se termine sur `{ ok: true,
 * processed: 0 }` et remet `last_error` à `null` — la boîte paraît saine alors
 * qu'elle rejette tout (allowlist vide = fail-closed). C'est exactement le
 * scénario rencontré le 2026-09-13 sur la boîte « Scanner Mairie » de SNA.
 *
 * Retourne `null` quand il n'y a rien à signaler, pour être passé tel quel à
 * `last_error` (qui doit redevenir `null` dès qu'une relève est propre).
 */
export function describeRejectedScanSenders(
  rejectedSenders: string[],
): string | null {
  const uniques = [...new Set(rejectedSenders.map((a) => a.trim().toLowerCase()).filter(Boolean))];
  if (!rejectedSenders.length) return null;
  const liste = uniques.length ? uniques.slice(0, 3).join(", ") : "expéditeur inconnu";
  const reste = uniques.length > 3 ? ` (+${uniques.length - 3} autre(s))` : "";
  return (
    `${rejectedSenders.length} message(s) ignoré(s) : expéditeur non autorisé — ` +
    `${liste}${reste}. Ajoutez ces adresses aux « Expéditeurs autorisés » de la boîte ` +
    `de numérisation, sinon aucun courrier n'entrera.`
  );
}
