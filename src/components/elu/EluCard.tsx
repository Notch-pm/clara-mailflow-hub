import { ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

/**
 * La carte cliquable de l'espace élu — file à signer, résultats de recherche,
 * courriers d'un usager. Une seule forme pour les trois, plutôt que trois
 * listes qui divergeraient : c'est la dette que `docs/technical-debt.md`
 * reproche déjà aux cinq pages de listes de l'application complète.
 */
export function EluCard({
  to,
  title,
  meta,
  badge,
  emphasis = false,
}: {
  to: string;
  title: string;
  meta?: string | null;
  badge?: React.ReactNode;
  /** Met en avant le chevron : la carte appelle une action, pas seulement une lecture. */
  emphasis?: boolean;
}) {
  return (
    <Link
      to={to}
      className="flex items-center gap-3.5 rounded-xl border bg-card p-4 text-left shadow-airbnb-sm transition-shadow active:shadow-airbnb"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="text-[17px] font-semibold leading-snug text-foreground [text-wrap:pretty]">
          {title}
        </span>
        {meta && <span className="text-[15px] text-muted-foreground">{meta}</span>}
        {badge}
      </span>
      <ChevronRight
        aria-hidden="true"
        className={cn("h-5 w-5 shrink-0", emphasis ? "text-primary" : "text-muted-foreground")}
      />
    </Link>
  );
}
