import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Lock, LockOpen } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { ConfidentialBadge } from "@/components/courier/ConfidentialBadge";
import { useAuth } from "@/contexts/AuthContext";
import { canClearConfidential, canSetConfidential, hasConfidentialAccess } from "@/lib/permissions";
import { setCourierConfidential } from "@/services/courierService";

/** Listes et fiches qui affichent le drapeau ou le masquage. */
const INVALIDATED = [
  "courier",
  "mailroom-couriers",
  "mailbox-couriers",
  "instruction-couriers",
  "couriers-outbound",
  "courier-events",
  "mailroom-courier",
];

/**
 * Le drapeau « confidentiel » d'un courrier : badge, et le geste permis.
 * Poser : un habilité ou le service courrier ; lever : un habilité. Qui pose
 * le drapeau sans être habilité perd l'accès au contenu : on le lui dit avant.
 */
export function ConfidentialToggle({
  courierId,
  isConfidential,
  /** Une réponse suit son courrier reçu : le drapeau se pose et se lève sur lui. */
  inherited = false,
  size = "sm",
  emptyLabel = null,
}: {
  courierId: string;
  isConfidential: boolean;
  inherited?: boolean;
  size?: "sm" | "default";
  /** Ce qu'on affiche quand le courrier n'est pas confidentiel et que je ne peux pas le marquer. */
  emptyLabel?: React.ReactNode;
}) {
  const { profile, membership } = useAuth();
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const habilite = hasConfidentialAccess(membership);

  const mutation = useMutation({
    mutationFn: (value: boolean) => setCourierConfidential(courierId, value),
    onSuccess: (_, value) => {
      INVALIDATED.forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));
      toast.success(value ? "Courrier marqué confidentiel" : "Confidentialité levée");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isConfidential) {
    return (
      <span className="inline-flex flex-wrap items-center gap-2">
        <ConfidentialBadge />
        {!inherited && canClearConfidential(membership) && (
          <Button
            variant="ghost"
            size={size}
            className="h-7 gap-1.5 px-2 text-xs font-semibold"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate(false)}
          >
            {mutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LockOpen className="h-3.5 w-3.5" />}
            Lever la confidentialité
          </Button>
        )}
      </span>
    );
  }

  if (inherited || !canSetConfidential(profile, membership)) return <>{emptyLabel}</>;

  return (
    <>
      <Button
        variant="outline"
        size={size}
        className="h-8 gap-1.5 text-xs font-semibold"
        disabled={mutation.isPending}
        onClick={() => (habilite ? mutation.mutate(true) : setConfirmOpen(true))}
      >
        {mutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Lock className="h-3.5 w-3.5" />}
        Marquer confidentiel
      </Button>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Marquer ce courrier confidentiel ?</AlertDialogTitle>
            <AlertDialogDescription>
              Seuls les membres habilités, et les viseurs et signataires désignés sur ses réponses,
              pourront le lire. Vous n'aurez plus accès à son contenu — vous pourrez toujours le router.
              Seul un membre habilité pourra lever la confidentialité.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={() => mutation.mutate(true)}>Marquer confidentiel</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
