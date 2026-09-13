import { useId } from "react";
import { Smartphone } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useEluMode } from "@/contexts/EluModeContext";

/**
 * Interrupteur de l'affichage simplifié, pour l'écran « Mon profil ».
 *
 * Le réglage vaut pour CET appareil : un élu qui a un téléphone et une tablette
 * les règle séparément, ce qui est le comportement souhaitable — la tablette a
 * la place d'afficher l'application complète.
 *
 * La carte ne se montre que là où le réglage a un effet : rôle élu, sur un
 * téléphone. Elle porte donc sa propre `Card`, faute de quoi « Mon profil »
 * afficherait un cadre vide à tous les autres.
 */
export function EluFullDisplayCard() {
  const { isElu, isPhone, optedOut, setOptedOut } = useEluMode();
  const id = useId();

  if (!isElu || !isPhone) return null;

  return (
    <Card>
      <CardContent className="flex flex-col gap-2 pt-6">
        <div className="flex items-start gap-3">
          <Switch
            id={id}
            checked={!optedOut}
            onCheckedChange={(checked) => setOptedOut(!checked)}
            className="mt-0.5"
          />
          <label htmlFor={id} className="flex min-w-0 cursor-pointer flex-col gap-0.5">
            <span className="flex items-center gap-1.5 text-sm font-medium">
              <Smartphone className="h-4 w-4 text-primary" aria-hidden="true" />
              Affichage simplifié
            </span>
            <span className="text-xs text-muted-foreground">
              Des écrans conçus pour le téléphone : ce qui attend votre signature, la recherche
              et les indicateurs.
            </span>
          </label>
        </div>
        <p className="text-xs text-muted-foreground">
          Réglage propre à cet appareil. Désactivez-le pour retrouver l'application complète,
          avec toutes ses fonctions.
        </p>
      </CardContent>
    </Card>
  );
}
