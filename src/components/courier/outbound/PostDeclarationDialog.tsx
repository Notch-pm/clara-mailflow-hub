import { Info, Printer } from "lucide-react";
import {
  POSTAL_MODES,
  postDeclarationError,
  todayIso,
  type PostalMode,
  type PostalVia,
} from "@/lib/outbound-channel";
import { POSTAL_SENDING_EXPLANATION } from "@/lib/postal-sending";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/** Ce que l'agent déclare : qui poste la lettre, quand, et comment. */
export interface PostDeclaration {
  via: PostalVia;
  date: string;
  time: string;
  mode: PostalMode;
}

interface Props {
  open: boolean;
  onClose: () => void;
  value: PostDeclaration;
  onChange: (value: PostDeclaration) => void;
  /** Le courrier ne peut pas partir avant d'avoir été créé. */
  createdAt: string | null | undefined;
  /** Envois papiers réels activés pour la collectivité : le prestataire est proposé. */
  providerAvailable: boolean;
  onPrint: () => void;
  onConfirm: () => void;
  pending: boolean;
}

/**
 * Envoi d'un courrier postal. Par le prestataire (envois papiers réels
 * activés) : Clara transmet la lettre, qui est imprimée et postée — facturé.
 * Par nos soins : imprimer, mettre sous pli, puis déclarer date, heure et type
 * d'envoi, tous obligatoires. Dans les deux cas, l'exemplaire conservé est la
 * lettre telle qu'elle est partie.
 */
export function PostDeclarationDialog({
  open, onClose, value, onChange, createdAt, providerAvailable, onPrint, onConfirm, pending,
}: Props) {
  const viaProvider = providerAvailable && value.via === "provider";
  const error = postDeclarationError({ ...value, via: viaProvider ? "provider" : "self" }, createdAt);
  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && !pending && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Envoi par courrier</AlertDialogTitle>
          <AlertDialogDescription>
            {viaProvider
              ? "La lettre est transmise au prestataire, qui l'imprime et la poste. Un exemplaire est conservé dans les documents du courrier ; l'envoi ne s'annule plus ensuite."
              : "Imprimez la lettre, mettez-la sous pli, puis indiquez quand et comment elle part. Un exemplaire de la lettre est conservé dans les documents du courrier ; la déclaration ne se modifie plus ensuite."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-4">
          {providerAvailable && (
            <RadioGroup
              aria-label="Qui poste la lettre"
              value={value.via}
              onValueChange={(v) => onChange({ ...value, via: v as PostalVia })}
              className="flex flex-col gap-2"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem id="post-via-provider" value="provider" />
                <Label htmlFor="post-via-provider" className="cursor-pointer text-sm font-normal">Envoi par le prestataire</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem id="post-via-self" value="self" />
                <Label htmlFor="post-via-self" className="cursor-pointer text-sm font-normal">Déposé par nos soins</Label>
              </div>
            </RadioGroup>
          )}

          {viaProvider ? (
            <div className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
              <p>{POSTAL_SENDING_EXPLANATION}</p>
            </div>
          ) : (
            <>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={onPrint}>
                <Printer className="h-4 w-4" />Imprimer la lettre
              </Button>
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="posted-on" className="text-sm">Date d'envoi</Label>
                  <Input
                    id="posted-on"
                    type="date"
                    required
                    value={value.date}
                    max={todayIso()}
                    min={createdAt ? todayIso(new Date(createdAt)) : undefined}
                    onChange={(e) => onChange({ ...value, date: e.target.value })}
                    className="h-9 w-[170px]"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="posted-time" className="text-sm">Heure d'envoi</Label>
                  <Input
                    id="posted-time"
                    type="time"
                    required
                    value={value.time}
                    onChange={(e) => onChange({ ...value, time: e.target.value })}
                    className="h-9 w-[120px]"
                  />
                </div>
              </div>
            </>
          )}

          <div className="space-y-1.5">
            <Label id="posted-mode-label" className="text-sm">Type d'envoi</Label>
            <RadioGroup
              aria-labelledby="posted-mode-label"
              value={value.mode}
              onValueChange={(v) => onChange({ ...value, mode: v as PostalMode })}
              className="flex flex-col gap-2"
            >
              {POSTAL_MODES.map((m) => (
                <div key={m.value} className="flex items-center gap-2">
                  <RadioGroupItem id={`posted-mode-${m.value}`} value={m.value} />
                  <Label htmlFor={`posted-mode-${m.value}`} className="cursor-pointer text-sm font-normal">
                    {m.label}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </div>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Annuler</AlertDialogCancel>
          <Button disabled={pending || !!error} onClick={onConfirm}>
            {pending ? (viaProvider ? "Envoi en cours…" : "Enregistrement…") : viaProvider ? "Envoyer" : "Confirmer l'envoi"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
