import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CONSENTS, consentStatement, type ConsentKind } from "@/lib/consents";
import {
  recordContactConsents,
  type ConsentAnswer,
  type SocleContact,
} from "@/services/socleContactService";

/**
 * Consignation MANUELLE d'un recueil de consentement RGPD par un agent :
 * formulaire papier joint à un courrier, retrait exprimé par lettre…
 *
 * Ce que l'agent voit ici est EXACTEMENT ce qui sera consigné : la phrase est
 * composée avec le même catalogue et le même nom d'organisation que le
 * serveur (`organizations.name`), et le serveur ne reçoit que `kind` et
 * `granted` — jamais la phrase. Décocher = refus ou retrait : le Socle
 * enregistre un fait, il n'exige rien, et un `collected_at` plus récent que
 * l'état courant le met à jour.
 */
export default function RecordConsentDialog({
  open,
  onOpenChange,
  organizationId,
  contact,
  organismName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  contact: SocleContact;
  organismName: string | null;
}) {
  const qc = useQueryClient();
  // Ce que la fiche porte aujourd'hui, pour que l'agent ne consigne que ce qui change.
  const [answers, setAnswers] = useState<Record<ConsentKind, boolean>>({
    traitement: contact.consent_traitement === true,
    partage: contact.consent_partage === true,
  });
  const [collectedAt, setCollectedAt] = useState(localDateTimeNow());
  const [reference, setReference] = useState("");

  useEffect(() => {
    if (!open) return;
    setAnswers({
      traitement: contact.consent_traitement === true,
      partage: contact.consent_partage === true,
    });
    setCollectedAt(localDateTimeNow());
    setReference("");
  }, [open, contact.consent_traitement, contact.consent_partage]);

  const collectedDate = new Date(collectedAt);
  const dateInvalid = Number.isNaN(collectedDate.getTime());
  const dateFuture = !dateInvalid && collectedDate.getTime() > Date.now();

  const mutation = useMutation({
    mutationFn: async () => {
      const payload: ConsentAnswer[] = CONSENTS.map((c) => ({ kind: c.kind, granted: answers[c.kind] }));
      return recordContactConsents(organizationId, contact.id, {
        answers: payload,
        collected_at: collectedDate.toISOString(),
        reference: reference.trim() || null,
      });
    },
    onSuccess: (saved) => {
      qc.setQueryData(["socle-contact", organizationId, contact.id], saved);
      qc.invalidateQueries({ queryKey: ["socle-contacts"] });
      toast.success("Recueil consigné au référentiel");
      onOpenChange(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Consignation impossible"),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !mutation.isPending && onOpenChange(o)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Consigner un recueil de consentement</DialogTitle>
          <DialogDescription>
            Ce que l'usager a accepté ou refusé, tel qu'il l'a exprimé (formulaire signé, courrier).
            Les phrases ci-dessous sont celles qui seront consignées au référentiel.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {CONSENTS.map((def) => {
            const id = `consent-${def.kind}`;
            return (
              <label
                key={def.kind}
                htmlFor={id}
                className="flex items-start gap-3 rounded-md border p-3 cursor-pointer"
              >
                <Checkbox
                  id={id}
                  checked={answers[def.kind]}
                  onCheckedChange={(v) => setAnswers((a) => ({ ...a, [def.kind]: v === true }))}
                  disabled={mutation.isPending}
                  className="mt-0.5"
                />
                <span className="space-y-1">
                  <span className="block text-sm font-medium">{def.label}</span>
                  <span className="block text-[13px] leading-relaxed text-muted-foreground">
                    « {consentStatement(def.kind, organismName)} »
                  </span>
                </span>
              </label>
            );
          })}
          <p className="text-xs text-muted-foreground">
            Décocher = refus ou retrait. Le référentiel garde chaque recueil ; seul le plus récent fixe l'état.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="consent-collected-at">Date du recueil</Label>
              <Input
                id="consent-collected-at"
                type="datetime-local"
                value={collectedAt}
                max={localDateTimeNow()}
                onChange={(e) => setCollectedAt(e.target.value)}
                disabled={mutation.isPending}
                aria-invalid={dateInvalid || dateFuture}
              />
              {dateFuture && <p className="text-xs text-destructive">La date ne peut pas être future.</p>}
              {dateInvalid && <p className="text-xs text-destructive">Date illisible.</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="consent-reference">Référence (facultatif)</Label>
              <Input
                id="consent-reference"
                value={reference}
                maxLength={200}
                placeholder="Chrono du courrier, n° de dossier…"
                onChange={(e) => setReference(e.target.value)}
                disabled={mutation.isPending}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
            Annuler
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || dateInvalid || dateFuture}>
            {mutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Consigner
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Valeur `datetime-local` de l'instant, en heure locale (le champ ne lit pas l'ISO). */
function localDateTimeNow(): string {
  const d = new Date();
  d.setSeconds(0, 0);
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 16);
}
