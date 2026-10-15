import { Copy, User } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ContactCategoryBadges } from "@/components/contacts/ContactCategoryBadge";
import { QuartierBadge } from "@/components/contacts/QuartierBadge";
import { channelLabel, civilityLabel, contactAddress, formatDate } from "@/lib/contact-labels";
import { SOCLE_CONTACT_TYPE_LABELS, type SocleContact } from "@/services/socleContactService";
import { CONTACT_TYPE_ICONS } from "@/components/contacts/contact-type-icons";

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm">{value?.trim() || "—"}</div>
    </div>
  );
}

/** Carte d'identité d'une fiche du référentiel : coordonnées, rôles, références, notes. */
export default function ContactInfoCard({ contact }: { contact: SocleContact }) {
  const TypeIcon = CONTACT_TYPE_ICONS[contact.contact_type] ?? User;
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3 flex-wrap">
          <TypeIcon className="h-6 w-6 text-muted-foreground" />
          <CardTitle className="text-xl">{contact.display_name || "—"}</CardTitle>
          <Badge variant="secondary">{SOCLE_CONTACT_TYPE_LABELS[contact.contact_type]}</Badge>
          <ContactCategoryBadges contact={contact} />
          {contact.status === "archived" && <Badge variant="destructive">Archivé</Badge>}
          <Badge variant="outline" className="ml-auto">Contact référentiel</Badge>
        </div>
        {/* L'id Socle est le numéro commun à la gamme : c'est lui qu'Iris affiche
            pour l'usager (socle_contact_id des demandes). */}
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <span>N° référentiel :</span>
          <code className="font-mono text-foreground select-all">{contact.id}</code>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            aria-label="Copier le numéro référentiel"
            onClick={() => {
              void navigator.clipboard.writeText(contact.id);
              toast.success("Numéro référentiel copié dans le presse-papier");
            }}
          >
            <Copy className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {contact.contact_type === "personne" ? (
            <>
              <InfoRow label="Civilité" value={civilityLabel(contact.civility)} />
              <InfoRow label="Prénom" value={contact.first_name} />
              <InfoRow label="Nom de naissance" value={contact.last_name} />
              <InfoRow label="Nom d'usage" value={contact.usage_name} />
              <InfoRow label="Date de naissance" value={contact.birth_date ? formatDate(contact.birth_date) : null} />
            </>
          ) : (
            <>
              <InfoRow label="Raison sociale" value={contact.legal_name} />
              <InfoRow label="SIRET" value={contact.siret} />
            </>
          )}
          <InfoRow label="Email" value={contact.email} />
          <InfoRow label="Téléphone mobile" value={contact.mobile_phone} />
          <InfoRow label="Téléphone fixe" value={contact.landline_phone} />
          <InfoRow label="Canal préféré" value={channelLabel(contact.preferred_channel)} />
        </div>
        <Separator />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <InfoRow label="Adresse" value={contactAddress(contact)} />
          <InfoRow label="Code postal" value={contact.postal_code} />
          <InfoRow label="Ville" value={contact.city} />
          <InfoRow label="Pays" value={contact.country} />
          <div>
            <div className="text-xs text-muted-foreground">Quartier</div>
            <div className="text-sm mt-0.5"><QuartierBadge quartier={contact.quartier} /></div>
          </div>
        </div>
        {contact.roles.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground">Rôles :</span>
            {contact.roles.map((r) => <Badge key={r.id} variant="outline">{r.name}</Badge>)}
          </div>
        )}
        {contact.external_references.length > 0 && (
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Références externes</div>
            {contact.external_references.map((ref) => (
              <div key={ref.id} className="text-sm">
                <span className="font-medium">{ref.source}</span> : {ref.external_id}
              </div>
            ))}
          </div>
        )}
        {contact.internal_notes && (
          <div className="rounded-md border bg-muted/50 p-3">
            <div className="text-xs text-muted-foreground mb-1">Notes internes (agents uniquement)</div>
            <div className="text-sm whitespace-pre-wrap">{contact.internal_notes}</div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
