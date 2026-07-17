import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Mail, Phone, X } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { cn } from "@/lib/utils";
import {
  DUPLICATE_REASON_LABELS,
  hasDuplicateSignal,
  type ContactDraft,
} from "@/lib/contact-duplicates";
import {
  findPotentialDuplicates,
  SOCLE_CONTACT_TYPE_LABELS,
  type SocleContact,
} from "@/services/socleContactService";

interface Props {
  organizationId: string;
  /** Saisie en cours ; l'interrogation du référentiel est débattue en interne. */
  draft: ContactDraft;
  /** Fiches déjà liées ou en cours d'édition, à ne pas proposer. */
  excludeIds?: string[];
  /** Reprendre la fiche existante au lieu d'en créer une nouvelle. */
  onSelect: (contact: SocleContact) => void;
  selectLabel?: string;
  /** Fiches proposées au maximum — court par défaut, l'alerte vit dans un dialog. */
  limit?: number;
  className?: string;
}

/**
 * Doublons potentiels du référentiel pour la saisie en cours, proposés à la
 * reprise plutôt qu'à la re-création. Silencieuse tant qu'aucune fiche ne
 * ressort — et jamais bloquante : si le référentiel est injoignable, la saisie
 * continue sans alerte.
 */
export default function DuplicateContactsAlert({
  organizationId,
  draft,
  excludeIds,
  onSelect,
  selectLabel = "Sélectionner",
  limit = 3,
  className,
}: Props) {
  // La saisie change à chaque frappe : on debounce une clé stable plutôt que
  // l'objet, dont l'identité change à chaque rendu (le timer ne retomberait
  // jamais à zéro).
  const draftKey = JSON.stringify(draft);
  const debouncedKey = useDebouncedValue(draftKey, 400);
  const debouncedDraft = useMemo(() => JSON.parse(debouncedKey) as ContactDraft, [debouncedKey]);
  const excludeKey = (excludeIds ?? []).join(",");
  const [dismissed, setDismissed] = useState<string[]>([]);

  const { data: candidates = [] } = useQuery({
    queryKey: ["socle-contact-duplicates", organizationId, debouncedKey, excludeKey, limit],
    queryFn: () => findPotentialDuplicates(organizationId, debouncedDraft, { excludeIds, limit }),
    enabled: !!organizationId && hasDuplicateSignal(debouncedDraft),
    staleTime: 30_000,
  });

  const visible = candidates.filter((c) => !dismissed.includes(c.contact.id));
  if (visible.length === 0) return null;

  return (
    <Alert className={cn("border-warning/50 bg-warning/5", className)}>
      <AlertTriangle className="h-4 w-4 text-warning" />
      <AlertTitle>
        {visible.length === 1
          ? "Un contact existant ressemble à cette saisie"
          : `${visible.length} contacts existants ressemblent à cette saisie`}
      </AlertTitle>
      <AlertDescription className="text-muted-foreground">
        Sélectionnez la fiche existante pour éviter de créer un doublon.
      </AlertDescription>

      <ul className="mt-3 space-y-2">
        {visible.map(({ contact, reasons }) => (
          <li key={contact.id} className="rounded-md border border-warning/30 bg-background px-3 py-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary" className="shrink-0">
                    {SOCLE_CONTACT_TYPE_LABELS[contact.contact_type]}
                  </Badge>
                  <span className="truncate text-sm font-medium">
                    {contact.display_name ?? contact.email ?? "—"}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                  {contact.email && (
                    <span className="inline-flex items-center gap-1 truncate">
                      <Mail className="h-3 w-3" aria-hidden="true" /> {contact.email}
                    </span>
                  )}
                  {(contact.mobile_phone || contact.landline_phone) && (
                    <span className="inline-flex items-center gap-1">
                      <Phone className="h-3 w-3" aria-hidden="true" />
                      {contact.mobile_phone ?? contact.landline_phone}
                    </span>
                  )}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {reasons.map((reason) => (
                    <Badge key={reason} variant="outline" className="text-[10px] font-normal">
                      {DUPLICATE_REASON_LABELS[reason]}
                    </Badge>
                  ))}
                </div>
              </div>
              <div className="flex shrink-0 flex-col gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => onSelect(contact)}
                >
                  {selectLabel}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs text-muted-foreground"
                  onClick={() => setDismissed((d) => [...d, contact.id])}
                >
                  <X className="mr-1 h-3 w-3" aria-hidden="true" /> Ignorer
                </Button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </Alert>
  );
}
