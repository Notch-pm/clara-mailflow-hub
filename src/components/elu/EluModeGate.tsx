import { Navigate, Outlet, useLocation } from "react-router-dom";
import { EluModeProvider, useEluMode } from "@/contexts/EluModeContext";

/**
 * Aiguillage entre l'application complète et l'espace élu.
 *
 * La redirection est rendue À LA PLACE de `<Outlet/>`, et non déclenchée dans un
 * effet : `AppLayout` ne monte donc jamais, et l'on ne voit pas le tableau de
 * bord complet clignoter avant de partir.
 *
 * L'aiguillage est volontairement ASYMÉTRIQUE. On ré-oriente depuis l'accueil,
 * qui n'est le choix de personne, et depuis les écrans devenus inaccessibles ;
 * on n'arrache jamais quelqu'un d'un écran qu'il a ouvert exprès — un courrier
 * atteint depuis une notification reste affiché, avec un simple retour vers
 * l'espace élu posé par `AppLayout`.
 */
function EluModeSwitch() {
  const { active } = useEluMode();
  const { pathname } = useLocation();
  const insideElu = pathname === "/elu" || pathname.startsWith("/elu/");

  if (active && pathname === "/") return <Navigate to="/elu" replace />;
  if (!active && insideElu) return <Navigate to="/" replace />;

  return <Outlet />;
}

export function EluModeGate() {
  return (
    <EluModeProvider>
      <EluModeSwitch />
    </EluModeProvider>
  );
}
