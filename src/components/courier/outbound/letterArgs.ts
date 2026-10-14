import { buildContactBlock, type ContactInfo, type PrintReplyOptions } from "@/utils/printReply";
import type { CourierParticipant } from "@/types/courier";
import type { OrgCoordinates } from "@/hooks/useOrgCoordinates";

interface LetterInput {
  bodyHtml: string;
  /** Objet saisi ; à défaut celui du sortant, puis celui proposé d'office. */
  subject: string;
  savedSubject: string | null | undefined;
  defaultSubject: string;
  /** Date de la lettre : celle du sortant, ou aujourd'hui s'il n'est pas enregistré. */
  createdAt: string | null | undefined;
  recipient: CourierParticipant | null;
  recipientEmail: string | null;
  organization: OrgCoordinates | null | undefined;
  service: { name: string } & ContactInfo;
}

/** Ce que la lettre imprimée (ou conservée à l'envoi postal) sait de ses correspondants. */
export function buildLetterArgs(input: LetterInput): PrintReplyOptions {
  const r = input.recipient;
  const recipientName = r ? `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() || r.name || null : null;
  return {
    bodyHtml: input.bodyHtml,
    subject: input.subject.trim() || input.savedSubject || input.defaultSubject,
    senderName: recipientName,
    senderFirstName: r?.first_name ?? null,
    senderLastName: r?.last_name ?? null,
    // L'usager du courrier : son adresse est en texte libre sur le participant,
    // pas décomposée comme celle d'une organisation.
    senderCompleteHtml: r
      ? buildContactBlock(recipientName, {
          organization: r.organization,
          address: r.address,
          phone: r.phone,
          email: input.recipientEmail,
        })
      : null,
    date: input.createdAt ?? new Date().toISOString(),
    organizationName: input.organization?.name ?? null,
    organizationCompleteHtml: input.organization ? buildContactBlock(input.organization.name, input.organization) : null,
    serviceName: input.service.name,
    serviceCompleteHtml: buildContactBlock(input.service.name, input.service),
  };
}
