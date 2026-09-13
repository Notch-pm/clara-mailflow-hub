import { ChevronLeft } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { useEluMode } from "@/contexts/EluModeContext";

/**
 * Retour vers l'espace élu, posé en tête des écrans complets.
 *
 * Un élu en mode simplifié atterrit malgré tout sur l'application complète
 * quand il suit un lien profond — la carte d'une notification pointe sur
 * `/courrier/:id`, qui peut viser un courrier entrant sans réponse associée et
 * n'a donc pas d'équivalent dans l'espace élu. Plutôt que de réécrire ces liens
 * au jugé, on laisse l'écran s'afficher et on offre le chemin du retour.
 */
export function EluReturnBanner() {
  const { active } = useEluMode();
  const { pathname } = useLocation();
  const insideElu = pathname === "/elu" || pathname.startsWith("/elu/");

  if (!active || insideElu) return null;

  return (
    <Link
      to="/elu"
      className="flex h-10 shrink-0 items-center gap-1 border-b bg-muted/60 px-4 text-sm font-semibold text-primary md:hidden"
    >
      <ChevronLeft className="h-4 w-4" aria-hidden="true" />
      Espace élu
    </Link>
  );
}
