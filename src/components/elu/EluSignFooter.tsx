import { useState } from "react";
import { Check, Stamp } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import type { EluAction } from "@/hooks/useSignAndAdvance";

/**
 * Pied d'action de l'écran de détail.
 *
 * `sticky` et non `fixed` : la barre d'URL de Safari iOS se rétracte au
 * défilement et recouvrirait un élément fixé au bas de la fenêtre.
 *
 * La raison d'un blocage s'affiche EN TEXTE sous le bouton, jamais en infobulle :
 * il n'y a pas de survol sur un téléphone, et un bouton gris sans explication
 * est une impasse.
 *
 * Signature et visa passent par une feuille de confirmation : la signature part
 * chez l'usager et ne se reprend pas ; le visa engage le nom du viseur, et la
 * feuille recueille son commentaire facultatif (consigné avec la trace).
 */
export function EluSignFooter({
  primary,
  secondary,
  isPending,
  confirmTitle,
  confirmBody,
}: {
  primary: EluAction | null;
  secondary: EluAction[];
  isPending: boolean;
  confirmTitle?: string;
  confirmBody?: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [comment, setComment] = useState("");

  if (!primary && secondary.length === 0) return null;

  const blocked = !!primary?.disabledReason;
  // Une transition ordinaire se défait par le workflow : pas de confirmation.
  const isVisa = primary?.id === "visa";
  const needsConfirm = primary?.id === "sign" || isVisa;
  const title =
    confirmTitle ?? (isVisa ? "Viser cette réponse ?" : "Confirmer la signature ?");
  const body =
    confirmBody ??
    (isVisa
      ? "Votre visa sera consigné à votre nom, puis la réponse passera à l'étape suivante."
      : "Le courrier sera signé en votre nom et envoyé à l'usager. Cette action est définitive.");

  return (
    <>
      {/* Pas de `safe-area-inset-bottom` : le pied est posé AU-DESSUS de la
          barre d'onglets, qui dégage déjà la barre système — la compter ici
          le faisait remonter d'autant (Firefox Android bord à bord, même
          défaut qu'`EluTabBar`). */}
      <div className="sticky bottom-0 z-10 flex flex-col gap-2.5 border-t bg-card px-5 pb-3.5 pt-3.5 shadow-[0_-6px_20px_-8px_rgb(0_0_0/0.12)]">
        {primary && (
          <>
            <button
              type="button"
              disabled={blocked || isPending}
              onClick={() => (needsConfirm ? setConfirming(true) : primary.run())}
              className="flex min-h-[60px] w-full items-center justify-center gap-2.5 rounded-xl bg-primary text-[19px] font-bold text-primary-foreground transition active:scale-[0.98] disabled:opacity-50"
            >
              {primary.id === "sign" && <Check className="h-[22px] w-[22px]" aria-hidden="true" />}
              {isVisa && <Stamp className="h-[22px] w-[22px]" aria-hidden="true" />}
              {isPending ? "En cours…" : primary.label}
            </button>
            {primary.disabledReason && (
              <p role="status" className="text-center text-[13px] text-muted-foreground">
                {primary.disabledReason}
              </p>
            )}
          </>
        )}

        {secondary.map((action) => (
          <button
            key={action.id}
            type="button"
            disabled={isPending}
            onClick={() => action.run()}
            className="min-h-[52px] w-full rounded-xl border bg-card text-[17px] font-semibold text-foreground disabled:opacity-50"
          >
            {action.label}
          </button>
        ))}
      </div>

      <Sheet open={confirming} onOpenChange={setConfirming}>
        <SheetContent
          side="bottom"
          role="alertdialog"
          className="gap-4 rounded-t-[20px] px-5 pb-6 pt-6"
        >
          <SheetTitle className="text-[21px] font-extrabold tracking-tight">{title}</SheetTitle>
          <SheetDescription className="text-base leading-relaxed">{body}</SheetDescription>
          {isVisa && (
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-bold text-muted-foreground">Commentaire (facultatif)</span>
              {/* 16 px au moins : en dessous, Safari iOS zoome sur le champ. */}
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={3}
                maxLength={1000}
                className="w-full rounded-xl border bg-background px-3.5 py-3 text-base text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
          )}
          <button
            type="button"
            disabled={isPending}
            onClick={() => primary?.run(isVisa ? comment : undefined)}
            className="min-h-14 w-full rounded-xl bg-primary text-[18px] font-bold text-primary-foreground disabled:opacity-50"
          >
            {isVisa ? (isPending ? "Visa…" : "Oui, viser") : isPending ? "Signature…" : "Oui, signer"}
          </button>
          <button
            type="button"
            autoFocus
            onClick={() => setConfirming(false)}
            className="min-h-[52px] w-full rounded-xl border bg-card text-[17px] font-semibold text-foreground"
          >
            Annuler
          </button>
        </SheetContent>
      </Sheet>
    </>
  );
}
