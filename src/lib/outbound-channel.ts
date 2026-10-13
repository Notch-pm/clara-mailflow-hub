// Le mode d'envoi d'un courrier sortant et ce qu'il exige du destinataire.
// Pur : partagé par la création et le composeur, testé par vitest.

export type OutboundChannel = "email" | "paper";

/** Ce que l'on sait du destinataire : une fiche du référentiel ou son instantané. */
export interface OutboundRecipientInfo {
  email?: string | null;
  address_line1?: string | null;
  postal_code?: string | null;
  city?: string | null;
  preferred_channel?: "email" | "telephone" | "courrier" | null;
}

/**
 * Le mode proposé d'office : celui que l'usager préfère s'il est praticable,
 * sinon le courriel s'il a une adresse électronique, sinon le courrier.
 */
export function defaultChannel(r: OutboundRecipientInfo | null | undefined): OutboundChannel {
  if (!r) return "paper";
  if (r.preferred_channel === "courrier") return "paper";
  if (r.preferred_channel === "email" && emailBlocker(r) === null) return "email";
  return emailBlocker(r) === null ? "email" : "paper";
}

/** Pourquoi on ne peut pas écrire à ce destinataire par courriel, ou `null`. */
export function emailBlocker(r: OutboundRecipientInfo | null | undefined): string | null {
  if (!r?.email?.trim()) return "Ce destinataire n'a pas d'adresse électronique dans le référentiel.";
  return null;
}

/** Pourquoi on ne peut pas lui écrire par courrier postal, ou `null`. */
export function postalBlocker(r: OutboundRecipientInfo | null | undefined): string | null {
  const missing = [
    !r?.address_line1?.trim() && "l'adresse",
    !r?.postal_code?.trim() && "le code postal",
    !r?.city?.trim() && "la ville",
  ].filter(Boolean) as string[];
  if (missing.length === 0) return null;
  return `Adresse postale incomplète : il manque ${joinFr(missing)}.`;
}

/** Le pavé d'adresse, ligne par ligne (lignes vides retirées). */
export function addressLines(r: (OutboundRecipientInfo & { address_line2?: string | null }) | null | undefined): string[] {
  if (!r) return [];
  const cityLine = [r.postal_code?.trim(), r.city?.trim()].filter(Boolean).join(" ");
  return [r.address_line1?.trim(), r.address_line2?.trim(), cityLine].filter((l): l is string => !!l);
}

function joinFr(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} et ${items[items.length - 1]}`;
}
