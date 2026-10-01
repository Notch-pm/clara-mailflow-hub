import { Search } from "lucide-react";
import { Link } from "react-router-dom";

/**
 * Champ de recherche de l'espace élu.
 *
 * Sur l'accueil, ce n'est qu'un LEURRE cliquable qui mène à l'écran de
 * recherche : un vrai champ y ouvrirait le clavier au milieu d'un écran de
 * lecture, et masquerait la moitié du contenu.
 */
export function EluSearchLink({ to = "/elu/recherche" }: { to?: string }) {
  return (
    <Link
      to={to}
      className="flex min-h-14 w-full items-center gap-3 rounded-xl border bg-card px-[18px] text-[17px] text-muted-foreground shadow-airbnb-sm"
    >
      <Search className="h-[22px] w-[22px] shrink-0" aria-hidden="true" />
      Rechercher une personne, un courrier
    </Link>
  );
}

export function EluSearchInput({
  value,
  onChange,
  autoFocus = false,
  placeholder = "Nom, adresse, objet du courrier",
  label = "Rechercher",
}: {
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
  placeholder?: string;
  label?: string;
}) {
  return (
    <div className="flex min-h-14 items-center gap-3 rounded-xl border bg-card px-4 shadow-airbnb-sm focus-within:ring-2 focus-within:ring-ring">
      <Search className="h-[22px] w-[22px] shrink-0 text-muted-foreground" aria-hidden="true" />
      <input
        type="search"
        value={value}
        autoFocus={autoFocus}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
        // 17 px et non moins : sous 16 px, iOS zoome à la mise au point et
        // l'écran part de travers.
        className="min-h-[54px] flex-1 border-none bg-transparent text-[17px] text-foreground outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}
