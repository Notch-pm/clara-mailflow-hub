import { Mail, MapPin, Phone } from "lucide-react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { EluEmptyState } from "@/components/elu/EluEmptyState";
import { EluScreen, EluScreenHeader } from "@/components/elu/EluScreenHeader";
import { EluStatusPill } from "@/components/elu/EluStatusPill";
import { QuartierBadge } from "@/components/contacts/QuartierBadge";
import { useOrganization } from "@/contexts/OrganizationContext";
import { getContact } from "@/services/socleContactService";
import { listContactCouriers } from "@/services/courierParticipantService";
import {
  contactAddress,
  contactInitials,
  contactPhone,
  contactSubtitle,
  telHref,
} from "@/lib/contact-display";

function Row({
  icon,
  children,
  href,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  href?: string;
}) {
  const content = (
    <>
      <span className="shrink-0 text-primary">{icon}</span>
      <span className="min-w-0 break-words">{children}</span>
    </>
  );
  const className =
    "flex min-h-16 items-center gap-3.5 border-b px-[18px] text-[17px] text-foreground last:border-b-0";
  return href ? (
    <a href={href} className={`${className} font-semibold`}>
      {content}
    </a>
  ) : (
    <div className={className}>{content}</div>
  );
}

export default function EluUsager() {
  const { contactId } = useParams<{ contactId: string }>();
  const { organizationId } = useOrganization();

  const { data: contact, isLoading } = useQuery({
    // Même clé que l'espace de travail complet, et surtout même invariant :
    // aucune identité d'usager ne reste en cache.
    queryKey: ["socle-contact", organizationId, contactId],
    queryFn: () => getContact(organizationId!, contactId!),
    enabled: !!organizationId && !!contactId,
    gcTime: 0,
    staleTime: 0,
  });

  const { data: couriers = [] } = useQuery({
    queryKey: ["contact-couriers", contactId],
    queryFn: () => listContactCouriers(contactId!),
    enabled: !!contactId,
    gcTime: 0,
  });

  if (isLoading) {
    return (
      <EluScreen>
        <EluScreenHeader title="Usager" withBack />
        <EluEmptyState>Chargement…</EluEmptyState>
      </EluScreen>
    );
  }

  if (!contact) {
    return (
      <EluScreen>
        <EluScreenHeader title="Usager introuvable" withBack />
        <EluEmptyState>Cette fiche n'est pas accessible depuis votre organisation.</EluEmptyState>
      </EluScreen>
    );
  }

  const phone = contactPhone(contact);
  const address = contactAddress(contact);

  return (
    <EluScreen>
      <EluScreenHeader title="" withBack />

      <div className="-mt-4 flex items-center gap-3.5">
        <span
          aria-hidden="true"
          className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-primary/10 text-[19px] font-extrabold text-primary"
        >
          {contactInitials(contact.display_name)}
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <h1 className="truncate text-2xl font-extrabold tracking-tight text-foreground">
            {contact.display_name ?? "Sans nom"}
          </h1>
          <span className="flex items-center gap-2 text-base text-muted-foreground">
            {contactSubtitle(contact)}
            {contact.quartier && <QuartierBadge quartier={contact.quartier} />}
          </span>
        </div>
      </div>

      <div className="overflow-hidden rounded-[--radius] border bg-card shadow-airbnb-sm">
        {/* Le téléphone est un lien : depuis un téléphone, c'est un appel. */}
        {phone && (
          <Row icon={<Phone className="h-[22px] w-[22px]" />} href={telHref(phone)}>
            {phone}
          </Row>
        )}
        {contact.email && (
          <Row icon={<Mail className="h-[22px] w-[22px]" />} href={`mailto:${contact.email}`}>
            {contact.email}
          </Row>
        )}
        {address && <Row icon={<MapPin className="h-[22px] w-[22px]" />}>{address}</Row>}
        {!phone && !contact.email && !address && (
          <Row icon={<MapPin className="h-[22px] w-[22px]" />}>Aucune coordonnée enregistrée</Row>
        )}
      </div>

      <div className="flex flex-col gap-2.5">
        <h2 className="text-[19px] font-bold text-foreground">Ses courriers</h2>
        {couriers.length === 0 ? (
          <EluEmptyState>Aucun courrier pour cet usager.</EluEmptyState>
        ) : (
          couriers.map((courier) => {
            const date = courier.received_at ?? courier.sent_at ?? courier.created_at;
            return (
              <div key={courier.id} className="flex flex-col gap-2 rounded-xl border bg-card p-4">
                <span className="text-[17px] font-semibold leading-snug text-foreground [text-wrap:pretty]">
                  {courier.subject ?? "Sans objet"}
                </span>
                <span className="flex items-center gap-2.5">
                  {courier.workflow_state && (
                    <EluStatusPill>{courier.workflow_state.name}</EluStatusPill>
                  )}
                  <span className="text-sm text-muted-foreground">
                    {date ? new Date(date).toLocaleDateString("fr-FR") : "—"}
                  </span>
                </span>
              </div>
            );
          })
        )}
      </div>
    </EluScreen>
  );
}
