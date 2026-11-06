import { Printer } from "lucide-react";
import {
  POSTAL_MODES,
  postDeclarationError,
  todayIso,
  type PostalMode,
} from "@/lib/outbound-channel";
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

/** Ce que l'agent déclare : quand la lettre est partie, et comment. */
export interface PostDeclaration {
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
  onPrint: () => void;
  onConfirm: () => void;
  pending: boolean;
}

/**
 * Envoi d'un courrier postal : imprimer, mettre sous pli, puis déclarer la
 * date, l'heure et le type d'envoi — tous trois obligatoires. L'exemplaire
 * conservé est la lettre telle qu'elle est partie.
 */
export function PostDeclarationDialog({ open, onClose, value, onChange, createdAt, onPrint, onConfirm, pending }: Props) {
  const error = postDeclarationError(value, createdAt);
  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && !pending && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Envoi par courrier</AlertDialogTitle>
          <AlertDialogDescription>
            Imprimez la lettre, mettez-la sous pli, puis indiquez quand et comment elle part. Un exemplaire de la lettre
            est conservé dans les documents du courrier ; la déclaration ne se modifie plus ensuite.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-4">
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
          <div className="space-y-1.5">
            <Label id="posted-mode-label" className="text-sm">Type d'envoi</Label>
            <RadioGroup
              aria-labelledby="posted-mode-label"
              value={value.mode}
              onValueChange={(v) => onChange({ ...value, mode: v as PostalMode })}
              className="flex items-center gap-4"
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
            {pending ? "Enregistrement…" : "Confirmer l'envoi"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
