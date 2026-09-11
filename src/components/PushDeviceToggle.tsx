// « Notifications sur cet appareil » — l'interrupteur, posé sur « Mon profil ».
// Il ne décide rien : `usePushSubscription` lit le navigateur et agit,
// `src/lib/push.ts` porte les règles et les textes.

import { BellRing } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { PUSH_COPY, PUSH_FOOTNOTE } from "@/lib/push";
import { usePushSubscription } from "@/hooks/usePushSubscription";

interface Props {
  /** Rappel « cet appareil, ce navigateur » — utile sur la page de profil. */
  footnote?: boolean;
}

export function PushDeviceToggle({ footnote = false }: Props) {
  const { state, loading, busy, error, enable, disable } = usePushSubscription();
  const on = state === "on";
  // Les quatre autres états ne sont pas des refus de l'agent mais des
  // impossibilités (navigateur, plateforme, déploiement) : l'interrupteur reste
  // visible et le sous-texte dit pourquoi il ne bouge pas.
  const canToggle = !loading && !busy && (state === "on" || state === "off");
  const id = "push-device-toggle";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start gap-3">
        <Switch
          id={id}
          checked={on}
          disabled={!canToggle}
          aria-busy={busy || undefined}
          onCheckedChange={() => void (on ? disable() : enable())}
          className="mt-0.5"
        />
        <label htmlFor={id} className="flex min-w-0 flex-col gap-0.5 cursor-pointer">
          <span className="flex items-center gap-1.5 text-sm font-medium">
            <BellRing className="h-4 w-4 text-primary" aria-hidden="true" />
            Notifications sur cet appareil
          </span>
          <span className="text-xs text-muted-foreground">
            {loading ? "Vérification…" : PUSH_COPY[state].hint}
          </span>
        </label>
      </div>
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
      {footnote ? <p className="text-xs text-muted-foreground">{PUSH_FOOTNOTE}</p> : null}
    </div>
  );
}
