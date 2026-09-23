import { BarChart3, Home, PenLine, Search, type LucideIcon } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useAuth } from "@/contexts/AuthContext";
import { canAccessStats } from "@/lib/permissions";

interface EluTab {
  title: string;
  url: string;
  icon: LucideIcon;
  end?: boolean;
}

const BASE_TABS: EluTab[] = [
  { title: "Accueil", url: "/elu", icon: Home, end: true },
  { title: "À signer", url: "/elu/a-signer", icon: PenLine },
  { title: "Rechercher", url: "/elu/recherche", icon: Search },
  { title: "Indicateurs", url: "/elu/indicateurs", icon: BarChart3 },
];

/**
 * Barre d'onglets de l'espace élu.
 *
 * Même jeton que le rail de l'application complète (`--rail`, bleu nuit) :
 * la navigation garde une seule couleur dans tout Clara, thème sombre compris.
 *
 * Marge du bas : dans un navigateur, c'est lui qui dégage la barre système du
 * téléphone. Y ajouter `safe-area-inset-bottom` la comptait deux fois — Firefox
 * Android (bord à bord) la signale, et la barre flottait trop haut (constaté le
 * 2026-09-23). La zone de sécurité ne sert qu'installé sur l'écran d'accueil
 * (`display-mode: standalone`), où rien d'autre ne la réserve.
 *
 * Les onglets naviguent en `replace`. Sans cela, chaque aller-retour entre deux
 * onglets empile une entrée d'historique et le bouton retour du téléphone
 * remonte tout le zapping au lieu de quitter l'application.
 */
export function EluTabBar({ signatureCount = 0 }: { signatureCount?: number }) {
  const { profile, membership } = useAuth();
  const tabs = BASE_TABS.filter((tab) =>
    tab.url === "/elu/indicateurs" ? canAccessStats(profile, membership) : true,
  );

  return (
    <nav
      aria-label="Navigation de l'espace élu"
      className="flex shrink-0 items-stretch gap-1 bg-rail px-2 pb-2 pt-2 [@media(display-mode:standalone)]:pb-[max(0.5rem,env(safe-area-inset-bottom))]"
    >
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const showBadge = tab.url === "/elu/a-signer" && signatureCount > 0;
        return (
          <NavLink
            key={tab.url}
            to={tab.url}
            end={tab.end}
            replace
            className="relative flex min-h-14 flex-1 flex-col items-center justify-center gap-1 rounded-xl text-[12px] font-bold text-rail-foreground/60 transition-colors hover:bg-rail-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rail-foreground"
            activeClassName="!text-rail-foreground !bg-rail-foreground/15"
          >
            <Icon className="h-[22px] w-[22px]" aria-hidden="true" />
            {tab.title}
            {showBadge && (
              <span className="absolute right-2 top-1 grid h-[22px] min-w-[22px] place-items-center rounded-full bg-secondary px-1.5 text-[12px] font-extrabold text-secondary-foreground">
                {signatureCount}
              </span>
            )}
          </NavLink>
        );
      })}
    </nav>
  );
}
