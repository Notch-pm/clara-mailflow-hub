import { Link, useLocation, useNavigate } from "react-router-dom";
import { ChevronsUpDown, LogOut, User } from "lucide-react";
import parametresIcon from "@/assets/icons/parametres.svg";
import notchLogo from "@/assets/logo-notch.svg";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/contexts/AuthContext";
import { AppSwitcher } from "@/components/AppSwitcher";
import { NotificationBell } from "@/components/NotificationBell";
import { canAccessSettings } from "@/lib/permissions";
import { CURRENT_APP } from "@/lib/apps";

export function AppHeader() {
  const location = useLocation();
  const navigate = useNavigate();
  const isSettings = location.pathname.startsWith("/parametres");
  const { profile, membership, signOut } = useAuth();
  const showSettings = canAccessSettings(profile, membership);

  const displayName = profile
    ? [profile.first_name, profile.last_name].filter(Boolean).join(" ") || profile.email
    : "Utilisateur";

  const initials = profile
    ? [profile.first_name?.[0], profile.last_name?.[0]].filter(Boolean).join("").toUpperCase() || "U"
    : "U";

  const roleName = membership?.role ?? "—";

  const organizationName = membership?.organization_name;
  const organizationLogo = membership?.organization_logo_url;
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background pl-0 pr-4 shrink-0">
      {/* Left: sélecteur d'application + marque + client */}
      <div className="flex min-w-0 items-center gap-3">
        {/* Même gouttière que le rail latéral : l'icône tombe dans sa colonne. */}
        <div className="grid w-[52px] shrink-0 place-items-center">
          <AppSwitcher />
        </div>

        <Link to="/" className="hidden shrink-0 md:block">
          <img src={notchLogo} alt="Edilumen" className="h-6 object-contain shadow-none" />
        </Link>

        <Separator orientation="vertical" className="hidden h-6 shrink-0 md:block" />

        {/* Client (organisation courante) : son logo, à défaut son nom */}
        {organizationLogo ? (
          <img
            src={organizationLogo}
            alt={organizationName ?? ""}
            className="h-7 max-w-[100px] shrink-0 object-contain sm:max-w-[140px]"
          />
        ) : (
          organizationName && (
            <span className="truncate text-sm font-medium text-muted-foreground" title={organizationName}>
              {organizationName}
            </span>
          )
        )}
      </div>

      <div className="flex-1" />

      {/* Produit courant, calé à droite contre le bloc utilisateur */}
      <div className="flex shrink-0 items-center gap-2">
        <span
          aria-hidden="true"
          className="grid h-6 w-6 place-items-center rounded-[7px] bg-primary/10 text-xs font-extrabold text-primary"
        >
          {CURRENT_APP.initial}
        </span>
        <span className="text-[17px] font-bold tracking-tight text-primary max-sm:sr-only">
          {CURRENT_APP.name}
        </span>
      </div>

      <Separator orientation="vertical" className="h-6 shrink-0" />

      {/* Right: Notifications + Settings + Profile */}
      <div className="flex items-center gap-2 shrink-0">
        <NotificationBell />
        {showSettings && (
          <Link
            to="/parametres"
            className={`flex items-center justify-center h-9 w-9 rounded-lg transition-colors ${
              isSettings
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
            title="Paramètres"
          >
            <img src={parametresIcon} alt="Paramètres" className="h-5 w-5" />
          </Link>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted transition-colors focus:outline-none">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-semibold">
                {initials}
              </div>
              <ChevronsUpDown className="h-3 w-3 text-muted-foreground hidden sm:block" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="bottom" align="end" className="w-48">
            <DropdownMenuLabel>
              <div className="flex flex-col">
                <span>{displayName}</span>
                <span className="text-xs font-normal text-muted-foreground capitalize">{roleName}</span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="gap-2 cursor-pointer" onClick={() => navigate("/mon-profil")}>
              <User className="h-4 w-4" />
              Mon profil
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="gap-2 cursor-pointer text-destructive"
              onClick={async () => {
                await signOut();
              }}
            >
              <LogOut className="h-4 w-4" />
              Déconnexion
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
