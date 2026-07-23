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
