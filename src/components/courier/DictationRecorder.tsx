import { Loader2, Mic, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { MAX_DICTATION_SECONDS, useDictation } from "@/lib/voice/useDictation";

function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

interface Props {
  /** La transcription, modifiable : l'utilisateur la relit avant le remplissage. */
  value: string;
  onChange: (text: string) => void;
  /** `touch` : gabarit de l'espace élu (grandes cibles, grands caractères). */
  variant?: "default" | "touch";
  disabled?: boolean;
}

/**
 * Dictée d'un courrier : on parle librement, la transcription s'affiche,
 * modifiable. Une nouvelle dictée S'AJOUTE à la précédente — on complète ce
 * qu'on a oublié sans tout redire.
 *
 * Le remplissage du formulaire (extraction IA) reste à l'écran appelant.
 */
export default function DictationRecorder({ value, onChange, variant = "default", disabled = false }: Props) {
  const dictation = useDictation((text) => {
    onChange(value.trim() ? `${value.trim()}\n${text}` : text);
  });
  const touch = variant === "touch";

  if (!dictation.supported) {
    return (
      <p className={cn("text-muted-foreground", touch ? "text-[17px]" : "text-sm")}>
        Ce navigateur ne permet pas la dictée. Utilisez un navigateur récent (Chrome, Edge, Firefox, Safari).
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {dictation.phase === "recording" ? (
        // Tactile : l'état sur une ligne pleine largeur, les deux gestes dessous
        // — côte à côte sur un téléphone, le libellé se cassait sur quatre lignes.
        <div
          className={cn(
            "flex gap-3 rounded-xl border border-destructive/40 bg-destructive/5",
            touch ? "flex-col p-4" : "items-center p-3",
          )}
        >
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span className="relative flex h-3 w-3 shrink-0" aria-hidden="true">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-60" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-destructive" />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className={cn("font-semibold text-foreground", touch ? "text-[17px]" : "text-sm")} role="status">
                {dictation.listening
                  ? `Je vous écoute… ${clock(dictation.elapsed)} / ${clock(MAX_DICTATION_SECONDS)}`
                  : "Autorisez l'accès au micro…"}
              </span>
              <span className="h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
                <span
                  className="block h-full rounded-full bg-primary transition-[width] duration-100"
                  style={{ width: `${Math.round(dictation.level * 100)}%` }}
                />
              </span>
            </div>
          </div>
          <div className={cn("flex gap-2", touch && "grid grid-cols-2")}>
            <Button
              type="button"
              variant={touch ? "outline" : "ghost"}
              size={touch ? "lg" : "sm"}
              onClick={dictation.cancel}
              aria-label="Annuler la dictée"
              className={cn("gap-2", touch && "min-h-12 rounded-xl text-[17px]")}
            >
              <X className="h-5 w-5" />
              {touch && "Annuler"}
            </Button>
            <Button
              type="button"
              size={touch ? "lg" : "sm"}
              onClick={dictation.stop}
              className={cn("gap-2", touch && "min-h-12 rounded-xl text-[17px]")}
            >
              <Square className="h-4 w-4" /> Terminer
            </Button>
          </div>
        </div>
      ) : dictation.phase === "transcribing" ? (
        <div
          className={cn(
            "flex items-center justify-center gap-2 rounded-xl border bg-muted/30 text-muted-foreground",
            touch ? "min-h-14 text-[17px]" : "min-h-11 text-sm",
          )}
          role="status"
        >
          <Loader2 className="h-5 w-5 animate-spin" /> Transcription en cours…
        </div>
      ) : (
        <Button
          type="button"
          variant={value.trim() ? "outline" : "default"}
          onClick={dictation.start}
          disabled={disabled}
          className={cn("gap-2", touch ? "min-h-14 rounded-xl text-[17px] font-semibold" : "self-start")}
        >
          <Mic className="h-5 w-5" />
          {value.trim() ? "Compléter en dictant" : "Commencer la dictée"}
        </Button>
      )}

      {dictation.error && (
        <p role="alert" className={cn("text-destructive", touch ? "text-[15px]" : "text-sm")}>
          {dictation.error}
        </p>
      )}

      {value.trim() ? (
        <div className="flex flex-col gap-1.5">
          <Textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            rows={touch ? 7 : 10}
            aria-label="Transcription de la dictée"
            className={cn("resize-y", touch && "rounded-xl px-4 py-3.5 text-[17px] leading-relaxed")}
          />
          <p className={cn("text-muted-foreground", touch ? "text-[15px]" : "text-xs")}>
            Relisez la transcription et corrigez-la si besoin, notamment les noms propres.
          </p>
        </div>
      ) : (
        dictation.phase === "idle" && (
          <p className={cn("text-muted-foreground", touch ? "text-[15px]" : "text-sm")}>
            Énoncez librement la demande : qui est l'usager, ce qu'il demande, le lieu, les dates, ses coordonnées.
            Jusqu'à {MAX_DICTATION_SECONDS / 60} minutes. L'enregistrement n'est pas conservé.
          </p>
        )
      )}
    </div>
  );
}
