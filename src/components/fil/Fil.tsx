import { cn } from "@/lib/utils";

/**
 * Le « fil » en bas d'un courrier ou d'une demande — réponses ou interventions,
 * commentaires internes, activité. Une seule forme pour le poste de travail et
 * l'espace élu ; `large` agrandit le texte pour le téléphone.
 */
export function FilSection({
  title,
  count,
  empty,
  large = false,
  children,
}: {
  title: string;
  count?: number;
  /** Affiché quand `count === 0`. */
  empty: string;
  large?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2.5">
      <h2 className={cn("font-bold text-foreground", large ? "text-[19px]" : "text-base")}>
        {title}
        {count !== undefined && count > 0 && (
          <span className="ml-1.5 font-normal text-muted-foreground">({count})</span>
        )}
      </h2>
      {count === 0 ? (
        <p className={cn("text-muted-foreground", large ? "text-base" : "text-sm")}>{empty}</p>
      ) : (
        <ol className="flex flex-col gap-2">{children}</ol>
      )}
    </section>
  );
}

export function FilEntry({
  title,
  detail,
  meta,
  body,
  badge,
  large = false,
}: {
  title: string;
  detail?: string | null;
  /** Date et auteur. */
  meta?: string | null;
  /** Texte long (commentaire, compte rendu), conservé avec ses retours à la ligne. */
  body?: string | null;
  badge?: React.ReactNode;
  large?: boolean;
}) {
  return (
    <li className={cn("flex flex-col gap-1 rounded-lg border bg-card", large ? "p-4" : "px-3 py-2.5")}>
      <span className="flex flex-wrap items-center gap-2">
        <span className={cn("font-semibold text-foreground", large ? "text-[17px]" : "text-sm")}>{title}</span>
        {badge}
      </span>
      {detail && <span className={cn("text-muted-foreground", large ? "text-[15px]" : "text-sm")}>{detail}</span>}
      {body && (
        <p className={cn("whitespace-pre-wrap text-foreground [text-wrap:pretty]", large ? "text-base" : "text-sm")}>{body}</p>
      )}
      {meta && <span className={cn("text-muted-foreground", large ? "text-sm" : "text-xs")}>{meta}</span>}
    </li>
  );
}
