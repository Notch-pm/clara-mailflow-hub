import { useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import ContactPicker from "./ContactPicker";
import InlineEditField from "./InlineEditField";
import { CONTACT_CATEGORIES } from "@/lib/contact-categories";
import type { SocleContact } from "@/services/socleContactService";

interface Props {
  organizationId: string;
  /** Nom porté par le participant `recipient` (instantané du courrier). */
  recipientName: string | null | undefined;
  /** Le participant est-il rattaché à une fiche ? */
  linked: boolean;
  /** Fiche résolue du destinataire, si rattachée et chargée. */
  contact: SocleContact | null | undefined;
  onLink: (contact: SocleContact | null) => Promise<void> | void;
  onSetName: (name: string | null) => Promise<void> | void;
  readOnly?: boolean;
  triggerClassName?: string;
  displayClassName?: string;
}

/**
 * Destinataire d'un courrier reçu : un contact Interne ou Élu du référentiel
 * (agent, service, élu de la collectivité), ou — à défaut — un nom libre, tel
 * que l'IMAP ou l'import en masse l'ont posé.
 */
export default function RecipientField({
  organizationId,
  recipientName,
  linked,
  contact,
  onLink,
  onSetName,
  readOnly,
  triggerClassName,
  displayClassName = "text-base font-semibold",
}: Props) {
  // Un nom déjà saisi sans fiche s'affiche d'abord en texte libre.
  const [freeText, setFreeText] = useState(!linked && !!recipientName?.trim());

  if (freeText) {
    return (
      <div className="space-y-1">
        <InlineEditField
          label=""
          value={recipientName ?? ""}
          placeholder="Nom du destinataire"
          maxLength={150}
          readOnly={readOnly}
          displayClassName={displayClassName}
          onSave={(v) => onSetName(v.trim() || null)}
        />
        {!readOnly && (
          <button
            type="button"
            className="text-xs text-primary hover:underline"
            onClick={() => setFreeText(false)}
          >
            Choisir un contact interne ou un élu
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <ContactPicker
          organizationId={organizationId}
          value={contact ?? null}
          onChange={(c) => void onLink(c)}
          roles={[...CONTACT_CATEGORIES]}
          disabled={readOnly}
          fallbackLabel={recipientName ?? undefined}
          placeholder="Interne ou élu…"
          triggerClassName={triggerClassName}
        />
        {linked && contact && (
          <Link
            to={`/contacts/${contact.id}`}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-muted hover:text-primary"
            aria-label="Voir la fiche du destinataire"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>
      {!readOnly && (
        <button
          type="button"
          className="text-xs text-muted-foreground hover:text-primary hover:underline"
          onClick={() => setFreeText(true)}
        >
          Saisir un nom libre
        </button>
      )}
    </div>
  );
}
