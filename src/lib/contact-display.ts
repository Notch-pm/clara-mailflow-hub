import { SOCLE_CONTACT_TYPE_LABELS, type SocleContact } from "@/services/socleContactService";

/**
 * Mise en forme d'un usager du référentiel, partagée par l'annuaire complet et
 * l'espace élu — pour que le même usager se lise pareil des deux côtés.
 */

/** Le mobile prime sur le fixe : c'est le numéro qu'on compose depuis un téléphone. */
export function contactPhone(contact: Pick<SocleContact, "mobile_phone" | "landline_phone">): string | null {
  return contact.mobile_phone?.trim() || contact.landline_phone?.trim() || null;
}

/** Numéro prêt pour un lien `tel:` — l'appelant refuse les espaces et les points. */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

/**
 * « Personne · Vernon », sous le nom.
 *
 * Le rôle du référentiel prime sur le type quand la collectivité en a défini un
 * (« Habitant », « Riverain »…) : c'est un vocabulaire qu'elle a choisi, là où
 * le type n'est qu'une catégorie technique.
 */
export function contactSubtitle(contact: SocleContact): string {
  const role = contact.roles?.[0]?.name;
  const kind = role || SOCLE_CONTACT_TYPE_LABELS[contact.contact_type] || null;
  return [kind, contact.city].filter(Boolean).join(" · ");
}

/** Adresse postale sur une ligne, telle qu'on l'écrirait sur une enveloppe. */
export function contactAddress(contact: SocleContact): string | null {
  const street = [contact.address_line1, contact.address_line2].filter(Boolean).join(", ");
  const city = [contact.postal_code, contact.city].filter(Boolean).join(" ");
  return [street, city].filter(Boolean).join(", ") || null;
}

/** Initiales d'un usager, pour la pastille de sa fiche. */
export function contactInitials(displayName: string | null | undefined): string {
  if (!displayName) return "?";
  const words = displayName.split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  return words
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}
