import { useState, useMemo, useEffect, useRef } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
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
import { Search, Sparkles, Plus, Trash2, ArrowRightLeft, Upload } from "lucide-react";
import { useOrganization } from "@/contexts/OrganizationContext";
import { supabase } from "@/integrations/supabase/client";
import { deleteCourier } from "@/services/courierService";
import { useUserServiceFilter, applyServiceFilter } from "@/hooks/useUserServiceFilter";
import { toast } from "@/hooks/use-toast";
import MailboxSidePanel from "@/components/courier/MailboxSidePanel";
import NewCourierDialog from "@/components/courier/NewCourierDialog";
import mailboxIcon from "@/assets/icons/mailbox.svg";
import type { CourierWithRelations } from "@/types/courier";

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
  const navigate = useNavigate();
  const [courierToDelete, setCourierToDelete] = useState<CourierWithRelations | null>(null);
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
  const [selectedCourier, setSelectedCourier] = useState<CourierWithRelations | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [newDialogOpen, setNewDialogOpen] = useState(false);

  const [searchParams, setSearchParams] = useSearchParams();
  const [pendingOpenId, setPendingOpenId] = useState<string | null>(null);
  const lastLogin = useMemo(() => getLastLogin(), []);
  // Heure d'ouverture de la page — pour détecter les courriers arrivés pendant la session
  const pageOpenTime = useRef(new Date().toISOString());

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
        .select("id, subject, direction, channel, received_at, sent_at, workflow_state_id, assigned_service, metadata, chrono, created_at, updated_at, courier_participants(id, role, name, email, usager_id)")
        .eq("organization_id", organizationId)
        .eq("direction", "inbound")
        .in("workflow_state_id", initialStateIds)
        .order("received_at", { ascending: false })
        .limit(100);

      if (search) query = query.ilike("subject", `%${search}%`);

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as unknown as CourierWithRelations[];
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
        .select("id, subject, direction, channel, received_at, sent_at, workflow_state_id, assigned_service, metadata, chrono, created_at, updated_at, courier_participants(id, role, name, email, usager_id)")
        .eq("organization_id", organizationId)
        .eq("direction", "inbound")
        .is("workflow_state_id", null)
        .order("received_at", { ascending: false })
        .limit(100);

      if (search) query = query.ilike("subject", `%${search}%`);

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as unknown as CourierWithRelations[];
    },
    enabled: !!organizationId,
  });

  const serviceFilter = useUserServiceFilter();

  const allCouriers = useMemo(() => {
    const assigned = couriers ?? [];
    const unassigned = unassignedCouriers ?? [];
    const merged = [...unassigned, ...assigned].sort((a, b) => {
      const da = a.received_at ?? a.created_at;
      const db = b.received_at ?? b.created_at;
      return new Date(db).getTime() - new Date(da).getTime();
    });
    return applyServiceFilter(merged, serviceFilter);
  }, [couriers, unassignedCouriers, serviceFilter]);

  const allCourierIds = useMemo(() => allCouriers.map((c) => c.id), [allCouriers]);

  const { data: transferredEventIds } = useQuery({
    queryKey: ["mailbox-transferred-ids", allCourierIds],
    queryFn: async () => {
      if (!allCourierIds.length) return [];
      const { data, error } = await supabase
        .from("courier_events")
        .select("courier_id")
        .in("courier_id", allCourierIds)
        .eq("event_type", "service_transferred");
      if (error) throw error;
      return [...new Set((data ?? []).map((e) => e.courier_id as string))];
    },
    enabled: allCourierIds.length > 0,
  });

  const transferredIdSet = useMemo(
    () => new Set(transferredEventIds ?? []),
    [transferredEventIds],
  );

  const { transferredCouriers, regularCouriers } = useMemo(() => ({
    transferredCouriers: allCouriers.filter((c) => transferredIdSet.has(c.id)),
    regularCouriers: allCouriers.filter((c) => !transferredIdSet.has(c.id)),
  }), [allCouriers, transferredIdSet]);

  // Étape 1 : capture le paramètre ?open= et nettoie l'URL immédiatement.
  // Séparé du reste pour éviter que le re-déclenchement sur allCouriers
  // ne relance la logique d'ouverture avec le même paramètre.
  useEffect(() => {
    const openId = searchParams.get("open");
    if (!openId) return;
    setPendingOpenId(openId);
    setSearchParams({}, { replace: true });
  }, [searchParams]);

  // Étape 2 : récupère directement le courrier par ID dès que pendingOpenId est défini.
  // On ne passe pas par allCouriers pour éviter d'attendre les requêtes de la boîte.
  useEffect(() => {
    if (!pendingOpenId || !organizationId) return;

    let cancelled = false;
    supabase
      .from("couriers")
      .select("*, courier_participants(*)")
      .eq("id", pendingOpenId)
      .eq("organization_id", organizationId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        if (data) {
          setSelectedCourier(data as CourierWithRelations);
          setPanelOpen(true);
        }
        setPendingOpenId(null);
      });
    return () => { cancelled = true; };
  }, [pendingOpenId, organizationId]);

  function isNew(courier: CourierWithRelations): boolean {
    if (!lastLogin) return false;
    const receivedAt = courier.received_at ?? courier.created_at;
    return new Date(receivedAt) > new Date(lastLogin);
  }

  // Arrivé pendant que l'utilisateur est sur cette page (via cron)
  function isNewThisSession(courier: CourierWithRelations): boolean {
    const receivedAt = courier.received_at ?? courier.created_at;
    return new Date(receivedAt) > new Date(pageOpenTime.current);
  }

  function getSender(courier: CourierWithRelations): { last: string; first: string } {
    const p = courier.courier_participants?.find((p) => p.role === "sender");
    if (!p) return { last: "—", first: "—" };
    return {
      last: p.last_name ?? p.name ?? p.email ?? "—",
      first: p.first_name ?? "—",
    };
  }

  function getRecipient(courier: CourierWithRelations): string {
    const p = courier.courier_participants?.find((p) => p.role === "recipient");
    return p?.last_name ?? p?.name ?? p?.email ?? "—";
  }

  function handleRowClick(courier: CourierWithRelations) {
    setSelectedCourier(courier);
    setPanelOpen(true);
  }

  function renderRow(c: CourierWithRelations) {
    const isNewCourier = isNew(c);
    const isJustArrived = isNewThisSession(c);
    const sender = getSender(c);
    return (
      <TableRow
        key={c.id}
        onClick={() => handleRowClick(c)}
        className={[
          "cursor-pointer hover:bg-muted/50 transition-colors",
          isNewCourier ? "border-l-[3px] border-l-secondary" : "border-l-[3px] border-l-transparent",
          isJustArrived ? "bg-secondary/10" : "",
        ].join(" ")}
      >
        <TableCell className="w-10">
          {isNewCourier && (
            <Sparkles className={`h-4 w-4 ${isJustArrived ? "text-secondary animate-pulse" : "text-secondary/70"}`} />
          )}
        </TableCell>
        <TableCell className="text-sm">
          {c.received_at
            ? new Date(c.received_at).toLocaleDateString("fr-FR")
            : "—"}
        </TableCell>
        <TableCell className="text-sm font-medium max-w-[280px] truncate">
          {c.subject ?? "Sans titre"}
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
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => navigate("/import-en-masse")}>
              <Upload className="h-4 w-4 mr-1" />
              Importer en masse
            </Button>
            <Button onClick={() => setNewDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-1" />
              Nouveau courrier
            </Button>
          </div>
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
        <div className="space-y-4">
          {transferredCouriers.length > 0 && (
            <div className="space-y-3 rounded-lg border-2 border-secondary p-4">
              <div className="flex items-center gap-2 text-base font-bold text-foreground">
                <ArrowRightLeft className="h-5 w-5" />
                Courriers transférés
              </div>
              <Card>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10"></TableHead>
                      <TableHead>Date de réception</TableHead>
                      <TableHead>Objet</TableHead>
                      <TableHead>Destinataire</TableHead>
                      <TableHead>Nom expéditeur</TableHead>
                      <TableHead>Prénom expéditeur</TableHead>
                      <TableHead className="w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {transferredCouriers.map((c) => renderRow(c))}
                  </TableBody>
                </Table>
              </Card>
            </div>
          )}
          {regularCouriers.length > 0 && (
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10"></TableHead>
                    <TableHead>Date de réception</TableHead>
                    <TableHead>Objet</TableHead>
                    <TableHead>Destinataire</TableHead>
                    <TableHead>Nom expéditeur</TableHead>
                    <TableHead>Prénom expéditeur</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {regularCouriers.map((c) => renderRow(c))}
                </TableBody>
              </Table>
            </Card>
          )}
        </div>
      )}

      {/* Side panel */}
      {organizationId && (
        <MailboxSidePanel
          courier={selectedCourier}
          open={panelOpen}
          onOpenChange={setPanelOpen}
          organizationId={organizationId}
          onDelete={(c) => setCourierToDelete(c as unknown as CourierWithRelations)}
          disableFullScreen
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
