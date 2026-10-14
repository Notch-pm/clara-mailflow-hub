import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import SenderMatchNotice from "@/components/courier/SenderMatchNotice";
import type { SuggestedSender } from "@/services/courierAnalysisService";
import {
  createSenderContact,
  type SocleContact,
  type SocleContactCivility,
} from "@/services/socleContactService";
import type { SenderMatch } from "../../../../supabase/functions/_shared/senderMatchLogic";

interface Props {
  organizationId: string;
  sender: SuggestedSender;
  match: SenderMatch<SocleContact> | null;
  civility: SocleContactCivility | "";
  onCivilityChange: (civility: SocleContactCivility) => void;
  civilityError?: string;
  /** Contact retenu : celui que l'analyse a reconnu, ou la fiche créée ici. */
  onContactChosen: (contact: SocleContact) => void;
  /** L'agent écarte l'expéditeur lu (ou sa fiche vient d'être créée). */
  onDismiss: () => void;
}

/** Expéditeur lu par l'analyse, sans contact du référentiel retenu : il y sera créé. */
export function ExtractedSenderCard({
  organizationId,
  sender,
  match,
  civility,
  onCivilityChange,
  civilityError,
  onContactChosen,
  onDismiss,
}: Props) {
  async function createNow() {
    if (!civility) return;
    try {
      const created = await createSenderContact(organizationId, civility, sender);
      onContactChosen(created);
      onDismiss();
      toast.success("Contact créé dans le référentiel et sélectionné");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
      <p className="text-xs font-medium text-primary">Expéditeur extrait par l'analyse</p>
      <div className="text-xs text-muted-foreground space-y-0.5">
        {(sender.first_name || sender.last_name) && (
          <div>{[sender.first_name, sender.last_name].filter(Boolean).join(" ")}</div>
        )}
        {sender.email && <div>{sender.email}</div>}
        {sender.phone && <div>{sender.phone}</div>}
      </div>
      {match && (
        <SenderMatchNotice
          match={match}
          selected={false}
          onUse={() => match.contact && onContactChosen(match.contact)}
        />
      )}
      <p className="text-xs text-muted-foreground">
        Le contact sera créé dans le référentiel à l'enregistrement du courrier.
      </p>
      {/* Le Socle exige la civilité pour créer une personne. */}
      <Select value={civility || undefined} onValueChange={(v) => onCivilityChange(v as SocleContactCivility)}>
        <SelectTrigger className={cn("h-7 text-xs", civilityError && "border-destructive")} aria-invalid={!!civilityError}>
          <SelectValue placeholder="Civilité (requise pour créer)" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="madame">Madame</SelectItem>
          <SelectItem value="monsieur">Monsieur</SelectItem>
        </SelectContent>
      </Select>
      {civilityError && <p className="text-xs text-destructive">{civilityError}</p>}
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="w-full h-7 text-xs"
        disabled={!civility}
        onClick={createNow}
      >
        Créer ce contact dans le référentiel
      </Button>
      <button
        type="button"
        className="text-xs text-muted-foreground hover:text-foreground transition-colors w-full text-center"
        onClick={onDismiss}
      >
        Ne pas renseigner d'expéditeur
      </button>
    </div>
  );
}
