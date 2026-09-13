import { LogOut, Monitor, User } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/contexts/AuthContext";
import { useEluMode } from "@/contexts/EluModeContext";
import { ORG_ROLES } from "@/lib/permissions";
import { orgInitials, personInitials } from "@/lib/elu-display";

/**
 * Bandeau d'identité de l'espace élu : pour qui, et au nom de quelle
 * collectivité. C'est aussi le seul point de sortie du mode simplifié.
 */
export function EluHeader() {
  const navigate = useNavigate();
  const { profile, membership, signOut } = useAuth();
  const { setOptedOut } = useEluMode();

  const displayName =
    [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") ||
    profile?.email ||
    "Utilisateur";

  // La qualité de signataire prime : c'est elle que l'élu voit au bas de ses
  // courriers. À défaut, le libellé du rôle plutôt qu'une ligne vide.
  const roleLabel = ORG_ROLES.find((r) => r.value === membership?.role)?.label ?? null;
  const subtitle = [displayName, membership?.signataire_title || roleLabel]
    .filter(Boolean)
    .join(" · ");

  const organizationName = membership?.organization_name ?? "";
  const organizationLogo = membership?.organization_logo_url;

  return (
    <header className="flex shrink-0 items-center gap-3 border-b bg-card px-5 py-3">
      {/* Le logo prime : c'est l'identité que la collectivité connaît déjà.
          La tuile d'initiales n'est qu'un repli. */}
      {organizationLogo ? (
        <img
          src={organizationLogo}
          alt={organizationName}
          className="h-10 w-10 shrink-0 rounded-xl object-contain"
        />
      ) : (
        <span
          aria-hidden="true"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary text-sm font-extrabold tracking-tight text-primary-foreground"
        >
          {orgInitials(organizationName)}
        </span>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[15px] font-bold leading-tight text-foreground">
          {organizationName}
        </span>
        <span className="truncate text-[13px] leading-snug text-muted-foreground">{subtitle}</span>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Mon compte"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-muted text-sm font-bold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {personInitials(profile?.first_name, profile?.last_name)}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="bottom" align="end" className="w-60">
          <DropdownMenuLabel className="font-normal">{displayName}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="gap-2" onClick={() => navigate("/mon-profil")}>
            <User className="h-4 w-4" />
            Mon profil
          </DropdownMenuItem>
          <DropdownMenuItem
            className="gap-2"
            onClick={() => {
              setOptedOut(true);
              navigate("/", { replace: true });
            }}
          >
            <Monitor className="h-4 w-4" />
            Affichage complet
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="gap-2 text-destructive"
            onClick={() => {
              void signOut();
            }}
          >
            <LogOut className="h-4 w-4" />
            Déconnexion
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
