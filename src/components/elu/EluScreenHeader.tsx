import { ChevronLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";

/**
 * Titre d'un écran de l'espace élu, avec sa variante « ‹ Retour ».
 *
 * Le retour appelle `navigate(-1)` : seuls le détail d'une réponse et la fiche
 * d'un usager empilent une entrée d'historique — les onglets, eux, naviguent
 * en `replace`.
 */
export function EluScreenHeader({
  title,
  subtitle,
  withBack = false,
}: {
  title: string;
  subtitle?: string | null;
  withBack?: boolean;
}) {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col gap-1">
      {withBack && (
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="-ml-1 mb-1 flex min-h-11 items-center gap-2 self-start text-[17px] font-bold text-primary"
        >
          <ChevronLeft className="h-[22px] w-[22px]" aria-hidden="true" />
          Retour
        </button>
      )}
      <h1 className="text-2xl font-extrabold tracking-tight text-foreground">{title}</h1>
      {subtitle && <p className="text-base text-muted-foreground">{subtitle}</p>}
    </div>
  );
}

/** Gouttière commune à tous les écrans de l'espace. */
export function EluScreen({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-5 px-5 pb-7 pt-6">{children}</div>;
}
