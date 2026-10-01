import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/*
 * Cellules des listes. Toutes tiennent sur une hauteur de ligne fixe (48 px,
 * 36 px en affichage compact) : le texte long se tronque au lieu de pousser la
 * ligne. La ligne de contexte de `ListCellTitle` disparaît en compact, via
 * `data-density` posé par `ListPage`.
 */

/**
 * Fond des en-têtes de colonnes : la teinte `muted` posée sur la carte. Il doit
 * être OPAQUE — l'en-tête reste collé en haut et les lignes défilent dessous.
 */
export const LIST_HEADER_SURFACE =
  "bg-card bg-[linear-gradient(hsl(var(--muted)/0.55),hsl(var(--muted)/0.55))]";

interface ListCellTitleProps {
  title: ReactNode;
  /** Ligne de contexte (correspondant, date…) sous le titre. */
  meta?: ReactNode;
  /** Pictogrammes devant le titre (nouveau, transféré…). */
  leading?: ReactNode;
}

/** Cellule principale, sur deux niveaux : objet puis contexte. */
export function ListCellTitle({ title, meta, leading }: ListCellTitleProps) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="flex min-w-0 items-center gap-1.5">
        {leading}
        <span className="truncate text-[13.5px] font-semibold text-foreground">{title}</span>
      </span>
      {meta && (
        <span className="truncate text-xs text-muted-foreground group-data-[density=compact]/list:hidden">{meta}</span>
      )}
    </div>
  );
}

/** Texte secondaire tronqué (organisation, destinataire…). */
export function ListCellText({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("block truncate text-[13px] text-muted-foreground", className)}>{children}</span>;
}

/** Date au format court, chiffres tabulaires : les colonnes s'alignent à droite. */
export function ListCellDate({ value }: { value: string | null | undefined }) {
  const date = value ? new Date(value) : null;
  const valid = date && !Number.isNaN(date.getTime());
  return (
    <span className="block whitespace-nowrap text-[12.5px] font-medium tabular-nums text-muted-foreground">
      {valid ? date.toLocaleDateString("fr-FR") : "—"}
    </span>
  );
}

const DOT_TONE = {
  warning: "bg-warning",
  primary: "bg-primary",
  muted: "bg-muted-foreground",
  success: "bg-success",
  destructive: "bg-destructive",
} as const;

export type StatusTone = keyof typeof DOT_TONE;

/**
 * Statut : pastille de couleur + libellé. La couleur n'est qu'un repère — le
 * libellé reste en couleur de texte, pour garder un contraste suffisant.
 */
export function StatusDot({ label, tone }: { label: string; tone: StatusTone }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 text-xs font-semibold text-foreground">
      <span aria-hidden="true" className={cn("h-1.5 w-1.5 shrink-0 rounded-full", DOT_TONE[tone])} />
      <span className="truncate">{label}</span>
    </span>
  );
}
