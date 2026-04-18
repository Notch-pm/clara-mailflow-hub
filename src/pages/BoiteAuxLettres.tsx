import { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Search, Sparkles, Plus, Trash2 } from "lucide-react";
import { useOrganization } from "@/contexts/OrganizationContext";
import { supabase } from "@/integrations/supabase/client";
import { deleteCourier } from "@/services/courierService";
import { toast } from "@/hooks/use-toast";
import MailboxSidePanel from "@/components/courier/MailboxSidePanel";
import NewCourierDialog from "@/components/courier/NewCourierDialog";
import mailboxIcon from "@/assets/icons/mailbox.svg";

const LAST_LOGIN_KEY = "clara_last_login_at";

function getLastLogin(): string | null {
  return localStorage.getItem(LAST_LOGIN_KEY);
}

export function recordLogin() {
  localStorage.setItem(LAST_LOGIN_KEY, new Date().toISOString());
}

export default function BoiteAuxLettres() {
  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();
  const [courierToDelete, setCourierToDelete] = useState<any | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function handleConfirmDelete() {
    if (!organizationId || !courierToDelete) return;
    setDeleting(true);
    const { error } = await deleteCourier(organizationId, courierToDelete.id);
    setDeleting(false);
    if (error) {
      toast({ title: "Erreur", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Courrier supprimé" });
    if (selectedCourier?.id === courierToDelete.id) {
      setPanelOpen(false);
      setSelectedCourier(null);
    }
    setCourierToDelete(null);
    queryClient.invalidateQueries({ queryKey: ["mailbox-couriers"] });
    queryClient.invalidateQueries({ queryKey: ["mailbox-unassigned"] });
  }
  const [search, setSearch] = useState("");
  const [selectedCourier, setSelectedCourier] = useState<any | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [newDialogOpen, setNewDialogOpen] = useState(false);

  const lastLogin = useMemo(() => getLastLogin(), []);

  // 1. Fetch initial workflow state IDs for this org
  const { data: initialStateIds } = useQuery({
    queryKey: ["initial-states", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("workflow_states")
        .select("id")
        .eq("is_initial", true);
      if (error) throw error;
      return (data ?? []).map((s) => s.id);
    },
    enabled: !!organizationId,
  });

  // 2. Fetch couriers at initial state
  const { data: couriers, isLoading } = useQuery({
    queryKey: ["mailbox-couriers", organizationId, initialStateIds, search],
    queryFn: async () => {
      if (!organizationId || !initialStateIds?.length) return [];
      let query = supabase
        .from("couriers")
        .select("*, courier_participants(*)")
        .eq("organization_id", organizationId)
        .eq("direction", "inbound")
        .in("workflow_state_id", initialStateIds)
        .order("received_at", { ascending: false });

      if (search) query = query.ilike("subject", `%${search}%`);

      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!organizationId && !!initialStateIds?.length,
  });

  // Also show couriers with no workflow_state (newly created, not yet assigned)
  const { data: unassignedCouriers } = useQuery({
    queryKey: ["mailbox-unassigned", organizationId, search],
    queryFn: async () => {
      if (!organizationId) return [];
      let query = supabase
        .from("couriers")
        .select("*, courier_participants(*)")
        .eq("organization_id", organizationId)
        .eq("direction", "inbound")
        .is("workflow_state_id", null)
        .order("received_at", { ascending: false });

      if (search) query = query.ilike("subject", `%${search}%`);

      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!organizationId,
  });

  const allCouriers = useMemo(() => {
    const assigned = couriers ?? [];
    const unassigned = unassignedCouriers ?? [];
    return [...unassigned, ...assigned].sort((a, b) => {
      const da = a.received_at ?? a.created_at;
      const db = b.received_at ?? b.created_at;
      return new Date(db).getTime() - new Date(da).getTime();
    });
  }, [couriers, unassignedCouriers]);

  function isNew(courier: any): boolean {
    if (!lastLogin) return false;
    const receivedAt = courier.received_at ?? courier.created_at;
    return new Date(receivedAt) > new Date(lastLogin);
  }

  function getSender(courier: any): { last: string; first: string } {
    const p = courier.courier_participants?.find((p: any) => p.role === "sender");
    if (!p) return { last: "—", first: "—" };
    return {
      last: p.last_name ?? p.name ?? p.email ?? "—",
      first: p.first_name ?? "—",
    };
  }

  function getRecipient(courier: any): string {
    const p = courier.courier_participants?.find((p: any) => p.role === "recipient");
    return p?.last_name ?? p?.name ?? p?.email ?? "—";
  }

  function handleRowClick(courier: any) {
    setSelectedCourier(courier);
    setPanelOpen(true);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <img src={mailboxIcon} alt="" className="h-6 w-6 text-primary" style={{ filter: "var(--icon-primary-filter, none)" }} />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Boîte aux lettres</h1>
          <p className="text-muted-foreground">
            Retrouvez ici les courriers reçus en attente de prise en charge.
          </p>
        </div>
      </div>

      {/* Search + actions */}
      <div className="flex items-center gap-2 justify-between flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Rechercher par objet…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        {organizationId && (
          <Button onClick={() => setNewDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Nouveau courrier
          </Button>
        )}
      </div>

      {/* Content */}
      {!organizationId ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Veuillez sélectionner une organisation pour voir les courriers.
          </CardContent>
        </Card>
      ) : isLoading ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">Chargement…</CardContent>
        </Card>
      ) : !allCouriers.length ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Aucun courrier en attente dans la boîte aux lettres.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10"></TableHead>
                <TableHead>Date de réception</TableHead>
                <TableHead>Destinataire</TableHead>
                <TableHead>Nom expéditeur</TableHead>
                <TableHead>Prénom expéditeur</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {allCouriers.map((c) => {
                const isNewCourier = isNew(c);
                const sender = getSender(c);
                return (
                  <TableRow
                    key={c.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => handleRowClick(c)}
                  >
                    <TableCell className="w-10">
                      {isNewCourier && (
                        <Sparkles className="h-4 w-4 text-amber-500" />
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {c.received_at
                        ? new Date(c.received_at).toLocaleDateString("fr-FR")
                        : "—"}
                    </TableCell>
                    <TableCell className="text-sm font-medium">{getRecipient(c)}</TableCell>
                    <TableCell className="text-sm font-medium">{sender.last}</TableCell>
                    <TableCell className="text-sm">{sender.first}</TableCell>
                    <TableCell className="w-10">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          setCourierToDelete(c);
                        }}
                        aria-label="Supprimer le courrier"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* Side panel */}
      {organizationId && (
        <MailboxSidePanel
          courier={selectedCourier}
          open={panelOpen}
          onOpenChange={setPanelOpen}
          organizationId={organizationId}
          onDelete={(c) => setCourierToDelete(c)}
        />
      )}

      {/* New courier dialog */}
      {organizationId && (
        <NewCourierDialog
          open={newDialogOpen}
          onOpenChange={setNewDialogOpen}
          organizationId={organizationId}
        />
      )}

      {/* Delete confirmation */}
      <AlertDialog
        open={!!courierToDelete}
        onOpenChange={(open) => !open && setCourierToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer ce courrier ?</AlertDialogTitle>
            <AlertDialogDescription>
              Cette action est définitive. Le courrier
              {courierToDelete?.subject ? ` « ${courierToDelete.subject} »` : ""} sera
              supprimé de la boîte aux lettres.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Suppression…" : "Supprimer"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
