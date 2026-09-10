import type { WorkflowCategory } from "@/types/courier";

/**
 * Teintes des catégories d'états de workflow. Les quatre catégories doivent
 * rester distinguables au premier coup d'œil : les tokens sémantiques ne
 * suffisent pas (`--success` et `--primary` portent le même vert), on s'appuie
 * donc sur une échelle de statut dédiée, définie ici et nulle part ailleurs.
 */
type Tone = {
  /** Pastille ronde de 8px placée devant un libellé d'état. */
  dot: string;
  /** Badge complet (bordure + fond + texte). */
  pill: string;
};

const TONES: Record<string, Tone> = {
  pending: {
    dot: "bg-amber-500",
    pill: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
  processing: {
    dot: "bg-blue-500",
    pill: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-400",
  },
  processed: {
    dot: "bg-emerald-500",
    pill: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
  archived: {
    dot: "bg-slate-400",
    pill: "border-slate-400/30 bg-slate-400/10 text-slate-600 dark:text-slate-300",
  },
};

const FALLBACK: Tone = {
  dot: "bg-muted-foreground/40",
  pill: "border-border bg-muted text-muted-foreground",
};

export function categoryTone(category?: WorkflowCategory | string | null): Tone {
  return (category && TONES[category]) || FALLBACK;
}
