import { Sparkles, Undo2, WandSparkles } from "lucide-react";
import { ACKNOWLEDGMENT_TYPE, RESPONSE_TYPES } from "../../../../supabase/functions/draft-reply/logic";
import { AcknowledgmentFields } from "../AcknowledgmentMentions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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
import { cn } from "@/lib/utils";
import type { OutboundAssistant } from "./useOutboundAssistant";

/** Rédaction sur consigne — courrier à l'initiative. */
export function InitiativeAssistantPanel({ assistant: a, busy }: { assistant: OutboundAssistant; busy: boolean }) {
  return (
    <div className="shrink-0 space-y-2 rounded-md border border-violet-200 bg-violet-50/60 p-3">
      <label htmlFor="initiative-prompt" className="flex items-center gap-2 text-sm font-medium text-violet-700">
        <Sparkles className="h-4 w-4 shrink-0" aria-hidden="true" />
        Que doit dire ce courrier ?
      </label>
      <Textarea
        id="initiative-prompt"
        value={a.initiativePrompt}
        onChange={(e) => a.setInitiativePrompt(e.target.value)}
        placeholder="Ex. : Convoquer M. Martin à la réunion de quartier du 12 novembre à 18 h, salle B. Ton cordial."
        maxLength={2000}
        className="min-h-[72px] resize-none bg-background text-sm"
        disabled={a.isDrafting}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{a.initiativePrompt.length} / 2000</span>
        <div className="flex items-center gap-2">
          {a.canUndoDraft && (
            <Button variant="ghost" size="sm" className="gap-1.5" onClick={a.undoInitiativeDraft} disabled={busy}>
              <Undo2 className="h-3.5 w-3.5" />
              Annuler la rédaction
            </Button>
          )}
          <Button
            size="sm"
            onClick={a.draftFromPrompt}
            disabled={a.isDrafting || busy || !a.initiativePrompt.trim()}
            className="gap-1.5 bg-violet-600 text-white hover:bg-violet-700"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {a.isDrafting ? "Rédaction en cours…" : "Rédiger avec l'assistant"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Un texte déjà écrit ne se remplace pas sans le dire. */
export function InitiativeOverwriteDialog({ assistant: a }: { assistant: OutboundAssistant }) {
  return (
    <AlertDialog open={a.confirmOverwrite} onOpenChange={a.setConfirmOverwrite}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remplacer le texte en cours ?</AlertDialogTitle>
          <AlertDialogDescription>
            L'assistant part de votre brouillon et de votre consigne, et propose un nouveau texte. Vous pourrez revenir
            au vôtre avec « Annuler la rédaction » tant que vous ne l'avez pas retouché.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Garder mon texte</AlertDialogCancel>
          <AlertDialogAction onClick={() => void a.runInitiativeDraft()}>Remplacer</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Rédaction d'une réponse par type, sur un éditeur encore vide. */
export function ReplyAssistantPanel({ assistant: a, receivedAt }: { assistant: OutboundAssistant; receivedAt: string | null }) {
  return (
    <div className="border rounded-md shrink-0">
      <button
        type="button"
        onClick={() => a.setPanelOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium text-violet-700 bg-violet-50 hover:bg-violet-100 transition-colors"
      >
        <Sparkles className="h-4 w-4 shrink-0" />
        Assistant IA
        <span className="ml-auto text-xs text-violet-500">{a.panelOpen ? "▲" : "▼"}</span>
      </button>

      {a.panelOpen && (
        <div className="p-3 space-y-3 bg-white border-t">
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">Type de réponse</p>
            <div className="flex flex-wrap gap-2">
              {RESPONSE_TYPES.map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => a.setResponseType(type)}
                  className={cn(
                    "px-3 py-1 rounded-full text-xs font-medium border transition-colors",
                    a.responseType === type
                      ? "bg-violet-600 text-white border-violet-600"
                      : "border-border text-muted-foreground hover:border-violet-400 hover:text-violet-700",
                  )}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>

          {a.responseType === ACKNOWLEDGMENT_TYPE && (
            <AcknowledgmentFields value={a.ackDetails} onChange={a.setAckDetails} receivedAt={receivedAt} />
          )}

          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">Instructions complémentaires</p>
            <Textarea
              value={a.instructions}
              onChange={(e) => a.setInstructions(e.target.value)}
              placeholder="Ex : Mentionner le délai de traitement de 15 jours, ton formel…"
              className="text-sm min-h-[80px] resize-none"
            />
          </div>

          <Button
            size="sm"
            onClick={a.draftByType}
            disabled={a.isDrafting || !a.responseType}
            className="gap-1.5 bg-violet-600 hover:bg-violet-700 text-white"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {a.isDrafting ? "Génération en cours…" : "Générer la réponse"}
          </Button>
        </div>
      )}
    </div>
  );
}

/** Améliorer mon message : la langue, jamais le sens. */
export function ImproveBar({ assistant: a, busy }: { assistant: OutboundAssistant; busy: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2 shrink-0">
      {a.canUndoImprove && (
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={a.undoImprove} disabled={busy}>
          <Undo2 className="h-3.5 w-3.5" />
          Annuler l'amélioration
        </Button>
      )}
      <Button
        variant="outline"
        size="sm"
        onClick={a.improve}
        disabled={busy || a.isDrafting}
        className="gap-1.5 border-violet-300 text-violet-700 hover:bg-violet-50 hover:text-violet-800"
      >
        <WandSparkles className="h-3.5 w-3.5" />
        {a.isImproving ? "Relecture…" : "Améliorer mon message"}
      </Button>
    </div>
  );
}
