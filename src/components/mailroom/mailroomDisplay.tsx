import {
  CircleCheck,
  CircleX,
  ClockAlert,
  CalendarClock,
  Gauge,
  Loader2,
  Route,
  Sparkles,
  TriangleAlert,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { formatDay } from "@/lib/courier-sla";
import { CONFIDENCE_BATCH_MIN, QUALIFY_REASONS, type MailroomItem, type MailroomStage } from "@/lib/mailroom";

/*
 * Rendu partagé de l'écran « Courrier entrant » : libellés et tons par étape,
 * contenu des deux colonnes de la liste. Tons = classes de tokens sémantiques
 * (`src/index.css`) : secondary (jaune Notch) pour ce qui attend le service
 * courrier, warning pour un renvoi, destructive pour un retard.
 */

export type Tone = "primary" | "secondary" | "warning" | "destructive" | "muted" | "foreground";

export const TONE_TEXT: Record<Tone, string> = {
  primary: "text-primary",
  secondary: "text-secondary-foreground",
  warning: "text-warning",
  destructive: "text-destructive",
  muted: "text-muted-foreground",
  foreground: "text-foreground",
};

export const TONE_CHIP: Record<Tone, string> = {
  primary: "bg-primary/10 text-primary",
  secondary: "bg-secondary/40 text-secondary-foreground",
  warning: "bg-warning/15 text-warning",
  destructive: "bg-destructive/10 text-destructive",
  muted: "bg-muted text-muted-foreground",
  foreground: "bg-muted text-foreground",
};

export const TONE_DOT: Record<Tone, string> = {
  primary: "bg-primary",
  secondary: "bg-secondary",
  warning: "bg-warning",
  destructive: "bg-destructive",
  muted: "bg-muted-foreground/40",
  foreground: "bg-foreground",
};

export function isTaken(item: MailroomItem): boolean {
  return !!item.row.taken_at || (!!item.row.workflow_state_id && !item.row.state_is_initial);
}

export function stageLabel(item: MailroomItem): { label: string; tone: Tone } {
  const map: Record<MailroomStage, { label: string; tone: Tone }> = {
    analysing: { label: "Analyse en cours", tone: "muted" },
    to_qualify: { label: "À qualifier", tone: "secondary" },
    to_validate: { label: "À valider", tone: "primary" },
    to_reorient: { label: "À réorienter", tone: "warning" },
    routed: { label: isTaken(item) ? "Pris en charge" : "Routé", tone: "foreground" },
    late: { label: "En retard", tone: "destructive" },
    done: { label: "Traité", tone: "muted" },
  };
  return map[item.stage];
}

export function shortDate(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
}

export function fullDate(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("fr-FR");
}

/** Jours ouvrés, au singulier comme au pluriel. */
export function businessDays(n: number): string {
  return `${n} j ouvré${n > 1 ? "s" : ""}`;
}

export interface Cell {
  text: string;
  icon: LucideIcon | null;
  tone: Tone;
  spin?: boolean;
}

/** Colonne « service » de la liste. */
export function serviceCell(item: MailroomItem, orgName: (id: string | null) => string | null): Cell {
  const { row } = item;
  switch (item.stage) {
    case "analysing":
      return { text: "—", icon: null, tone: "muted" };
    case "to_qualify": {
      const name = orgName(row.suggested_socle_organization_id);
      return { text: name ? `${name} ?` : "—", icon: null, tone: name ? "foreground" : "muted" };
    }
    case "to_validate":
      return { text: orgName(row.suggested_socle_organization_id) ?? "—", icon: Sparkles, tone: "foreground" };
    case "to_reorient":
      return { text: `Renvoyé par ${row.returned_from ?? "un service"}`, icon: Undo2, tone: "foreground" };
    default:
      return { text: row.assigned_service ?? "—", icon: null, tone: "foreground" };
  }
}

/** Colonne « statut » de la liste. */
export function statusCell(item: MailroomItem): Cell {
  const { row, primary } = item;
  switch (item.stage) {
    case "analysing":
      return { text: row.analysis_status === "running" ? "Lecture et analyse…" : "En file d'analyse", icon: Loader2, tone: "muted", spin: true };
    case "to_qualify": {
      const failed = item.reason === "analysis_failed";
      return { text: QUALIFY_REASONS[item.reason!].title, icon: failed ? CircleX : TriangleAlert, tone: failed ? "destructive" : "secondary" };
    }
    case "to_validate": {
      const conf = row.suggested_service_confidence;
      if (conf === null) return { text: "Confiance non chiffrée", icon: Gauge, tone: "muted" };
      return { text: `Confiance ${conf} %`, icon: Gauge, tone: conf >= CONFIDENCE_BATCH_MIN ? "primary" : conf >= 80 ? "foreground" : "secondary" };
    }
    case "to_reorient":
      return { text: `Renvoyé le ${shortDate(row.returned_at)} · à réorienter`, icon: Route, tone: "warning" };
    case "done":
      return { text: `Clôturé le ${shortDate(row.resolved_at)}`, icon: CircleCheck, tone: "muted" };
    case "late": {
      const what = primary?.axis === "ack" ? (isTaken(item) ? "Accusé en retard" : "Non pris en charge") : "Réponse en retard";
      const days = Math.abs(primary?.status.margin ?? 0) || 1;
      return { text: `${what} · ${businessDays(days)}`, icon: ClockAlert, tone: "destructive" };
    }
    case "routed": {
      const due = item.sla.resolution.dueDay ?? primary?.status.dueDay ?? null;
      const soon = primary?.status.kind === "due_soon";
      const dueText = due ? `éch. ${formatDay(due).slice(0, 5)}` : "sans échéance";
      return {
        text: isTaken(item) ? `Pris en charge · ${dueText}` : `Non pris en charge · ${dueText}`,
        icon: CalendarClock,
        tone: soon ? "secondary" : "muted",
      };
    }
  }
}
