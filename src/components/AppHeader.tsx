import { Link, useLocation } from "react-router-dom";
import { ChevronsUpDown, LogOut, User } from "lucide-react";
import parametresIcon from "@/assets/icons/parametres.svg";
import notchLogo from "@/assets/logo-notch.png";
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

export function AppHeader() {
  const location = useLocation();
  const isSettings = location.pathname.startsWith("/parametres");
  const { profile, membership, signOut } = useAuth();

  const displayName = profile
    ? [profile.first_name, profile.last_name].filter(Boolean).join(" ") || profile.email
    : "Utilisateur";

  const initials = profile
    ? [profile.first_name?.[0], profile.last_name?.[0]].filter(Boolean).join("").toUpperCase() || "U"
    : "U";

  const roleName = membership?.role ?? "—";

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background px-4 shrink-0">
      {/* Left: Notch logo + org logo */}
      <div className="flex items-center gap-3 shrink-0">
        <Link to="/">
          <img src={notchLogo} alt="Notch - Clara" className="h-5 object-contain shadow-none" />
        </Link>
        {membership?.organization_logo_url && (
          <>
            <Separator orientation="vertical" className="h-6" />
            <img
              src={membership.organization_logo_url}
              alt={membership.organization_name}
              className="h-7 max-w-[120px] object-contain"
            />
          </>
        )}
        {!membership?.organization_logo_url && membership?.organization_name && (
          <>
            <Separator orientation="vertical" className="h-6" />
            <span className="text-sm font-medium text-muted-foreground">{membership.organization_name}</span>
          </>
        )}
      </div>

      <div className="flex-1" />

      {/* Right: Settings + Profile */}
      <div className="flex items-center gap-2 shrink-0">
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
            <DropdownMenuItem className="gap-2 cursor-pointer">
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
