import { Printer } from "lucide-react";
import { todayIso } from "@/lib/outbound-channel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface Props {
  open: boolean;
  onClose: () => void;
  date: string;
  onDateChange: (date: string) => void;
  /** Le courrier ne peut pas partir avant d'avoir été créé. */
  minDate: string | undefined;
  onPrint: () => void;
  onConfirm: () => void;
  pending: boolean;
}

/**
 * Imprimer, mettre sous pli, puis déclarer « posté » : l'exemplaire conservé
 * est la lettre telle qu'elle est partie.
 */
export function PostDeclarationDialog({ open, onClose, date, onDateChange, minDate, onPrint, onConfirm, pending }: Props) {
  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && !pending && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Imprimer et marquer posté</AlertDialogTitle>
          <AlertDialogDescription>
            Imprimez la lettre, mettez-la sous pli, puis confirmez la date à laquelle elle part. Un exemplaire de la lettre
            est conservé dans les documents du courrier ; la déclaration ne se modifie plus ensuite.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-3">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={onPrint}>
            <Printer className="h-4 w-4" />Imprimer la lettre
          </Button>
          <div className="flex items-center gap-2">
            <Label htmlFor="posted-on" className="text-sm">Posté le</Label>
            <Input
              id="posted-on"
              type="date"
              value={date}
              max={todayIso()}
              min={minDate}
              onChange={(e) => onDateChange(e.target.value)}
              className="h-9 w-[170px]"
            />
          </div>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Annuler</AlertDialogCancel>
          <Button disabled={pending || !date} onClick={onConfirm}>
            {pending ? "Enregistrement…" : "Confirmer l'envoi"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
