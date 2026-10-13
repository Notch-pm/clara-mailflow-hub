/**
 * Nature d'un courrier sortant et son destinataire, sans React ni Supabase.
 *
 * Un sortant est une RÉPONSE quand il a un courrier parent, un courrier À
 * L'INITIATIVE de la collectivité sinon (`parent_courier_id IS NULL`, règle R1
 * de `docs/specs/courriers-sortants.md`). Le lien d'un sortant à l'initiative
 * vers un entrant passe par `courier_relations`, jamais par le parent.
 */

export type OutboundKind = "reply" | "initiative";

export const OUTBOUND_KIND_LABELS: Record<OutboundKind, string> = {
  reply: "Réponse",
  initiative: "Initiative",
};

/** Phrase longue, pour un lecteur d'écran ou un titre d'infobulle. */
export const OUTBOUND_KIND_DESCRIPTIONS: Record<OutboundKind, string> = {
  reply: "Réponse à un courrier reçu",
  initiative: "Courrier à l'initiative de la collectivité",
};

export function outboundKind(parentCourierId: string | null | undefined): OutboundKind {
  return parentCourierId ? "reply" : "initiative";
}

/**
 * Le sortant est-il « parti » — signé, envoyé par courriel ou posté ? Dès lors,
 * son destinataire et son expéditeur ne se changent plus.
 */
export function isOutboundSettled(
  meta: { signed_at?: unknown; sent_email_at?: unknown; posted_at?: unknown } | null | undefined,
): boolean {
  return !!meta?.signed_at || !!meta?.sent_email_at || !!meta?.posted_at;
}

export interface ParticipantLike {
  role: string;
  name: string | null;
  first_name: string | null;
  last_name: string | null;
  socle_contact_id?: string | null;
}

export function participantName(p: Pick<ParticipantLike, "name" | "first_name" | "last_name">): string | null {
  return p.name?.trim() || [p.first_name, p.last_name].filter(Boolean).join(" ").trim() || null;
}

export interface OutboundRecipient {
  name: string | null;
  /** Fiche du Socle, quand le destinataire y est rapproché. */
  contactId: string | null;
}

/**
 * À qui part le courrier. Le destinataire du sortant d'abord ; pour une
 * réponse, l'expéditeur du courrier reçu à défaut — la réponse le recopie à la
 * création, mais il manque quand elle a été créée à la main.
 */
export function outboundRecipient(
  own: readonly ParticipantLike[] | null | undefined,
  parent: readonly ParticipantLike[] | null | undefined,
): OutboundRecipient | null {
  // Une seule personne : on ne mêle jamais le nom de l'un à la fiche de l'autre.
  const person =
    (own ?? []).find((p) => p.role === "recipient") ?? (parent ?? []).find((p) => p.role === "sender");
  if (!person) return null;
  const name = participantName(person);
  const contactId = person.socle_contact_id || null;
  if (!name && !contactId) return null;
  return { name, contactId };
}

/**
 * « À Thierry Henry · courrier reçu le 04/09/2026 » pour une réponse,
 * « À Thierry Henry » pour un courrier à l'initiative — il n'a rien reçu.
 */
export function outboundMetaLine(item: {
  kind: OutboundKind;
  recipientName: string | null;
  receivedAt: string | null;
}): string | null {
  const parts = [
    item.recipientName ? `À ${item.recipientName}` : null,
    item.kind === "reply" && item.receivedAt
      ? `courrier reçu le ${new Date(item.receivedAt).toLocaleDateString("fr-FR")}`
      : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}
