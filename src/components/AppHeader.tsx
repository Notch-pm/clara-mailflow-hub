import { Link, useLocation } from "react-router-dom";
import { ChevronsUpDown, LogOut, User, Mail, Building2 } from "lucide-react";
import parametresIcon from "@/assets/icons/parametres.svg";
import { useEffect, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useOrganization } from "@/contexts/OrganizationContext";
import { supabase } from "@/integrations/supabase/client";

export function AppHeader() {
  const location = useLocation();
  const isSettings = location.pathname.startsWith("/parametres");
  const { organizationId, setOrganizationId } = useOrganization();
  const [orgs, setOrgs] = useState<{ id: string; name: string }[]>([]);
  const [manualId, setManualId] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);

  // Fetch organizations (will only return those matching current x-org-id header,
  // so we do a raw fetch without the header to list all accessible orgs)
  useEffect(() => {
    async function loadOrgs() {
      // Use service_role or a public listing — for now try to fetch what's accessible
      const { data } = await supabase.from("organizations").select("id, name").limit(50);
      if (data?.length) setOrgs(data);
    }
    loadOrgs();
  }, [organizationId]);

  const currentOrg = orgs.find((o) => o.id === organizationId);

  const handleSetManual = () => {
    if (manualId.trim()) {
      setOrganizationId(manualId.trim());
      setDialogOpen(false);
      setManualId("");
    }
  };

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background px-4 shrink-0">
      <div className="flex items-center gap-2.5 shrink-0">
        <Link to="/" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Mail className="h-4 w-4" />
          </div>
          <span className="text-lg font-bold tracking-tight text-foreground">Clara</span>
        </Link>
      </div>

      {/* Organization selector */}
      <div className="flex items-center gap-2 ml-4">
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2 text-xs max-w-[240px]">
              <Building2 className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">
                {currentOrg ? currentOrg.name : organizationId ? `Org: ${organizationId.slice(0, 8)}…` : "Choisir une organisation"}
              </span>
              <ChevronsUpDown className="h-3 w-3 text-muted-foreground shrink-0" />
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Sélectionner une organisation</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              {orgs.length > 0 && (
                <div className="space-y-1">
                  {orgs.map((org) => (
                    <button
                      key={org.id}
                      onClick={() => { setOrganizationId(org.id); setDialogOpen(false); }}
                      className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                        org.id === organizationId ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted"
                      }`}
                    >
                      {org.name}
                    </button>
                  ))}
                </div>
              )}
              <div className="border-t pt-3 space-y-2">
                <p className="text-xs text-muted-foreground">Ou saisir l'ID manuellement :</p>
                <div className="flex gap-2">
                  <Input
                    placeholder="UUID de l'organisation"
                    value={manualId}
                    onChange={(e) => setManualId(e.target.value)}
                    className="text-xs"
                    onKeyDown={(e) => e.key === "Enter" && handleSetManual()}
                  />
                  <Button size="sm" onClick={handleSetManual} disabled={!manualId.trim()}>
                    OK
                  </Button>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex-1" />

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
                U
              </div>
              <ChevronsUpDown className="h-3 w-3 text-muted-foreground hidden sm:block" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="bottom" align="end" className="w-48">
            <DropdownMenuLabel>
              <div className="flex flex-col">
                <span>Utilisateur</span>
                <span className="text-xs font-normal text-muted-foreground">Administrateur</span>
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
                await supabase.auth.signOut();
                window.location.href = "/";
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
