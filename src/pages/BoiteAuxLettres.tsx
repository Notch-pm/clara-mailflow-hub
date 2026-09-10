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
import { Search, Sparkles, Plus, Trash2, ArrowRightLeft, Upload, Weight } from "lucide-react";
import { useOrganization } from "@/contexts/OrganizationContext";
import { useAuth } from "@/contexts/AuthContext";
import { canEditCouriers } from "@/lib/permissions";
import { supabase } from "@/integrations/supabase/client";
import { deleteCourier } from "@/services/courierService";
import type {
  CourierListFilters,
  CourierListRow,
  CourierSortKey,
} from "@/services/courierListService";
import { useUserServiceFilter } from "@/hooks/useUserServiceFilter";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useCourierList } from "@/hooks/useCourierList";
import { DataTablePagination } from "@/components/data-table/data-table-pagination";
import {
  SortableHeader,
  ariaSort,
  type SortDirection,
} from "@/components/data-table/data-table-column-header";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  const { profile, membership } = useAuth();
  const canEdit = canEditCouriers(profile, membership);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [courierToDelete, setCourierToDelete] = useState<CourierListRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [tab, setTab] = useState<"all" | "transferred">("all");

  async function handleConfirmDelete() {
    if (!organizationId || !courierToDelete) return;
    setDeleting(true);
    const { error } = await deleteCourier(organizationId, courierToDelete.id);
    setDeleting(false);
    if (error) {
      const isLinkedReply = error.message?.includes("parent_courier_id");
      toast({
        title: "Suppression impossible",
        description: isLinkedReply
          ? "Ce courrier a des réponses associées. Supprimez d'abord les réponses avant de supprimer le courrier parent."
          : error.message,
        variant: "destructive",
      });
      return;
    }
    toast({ title: "Courrier supprimé" });
    if (selectedCourier?.id === courierToDelete.id) {
      setPanelOpen(false);
      setSelectedCourier(null);
    }
    setCourierToDelete(null);
    // Une seule clé désormais : la requête « mailbox-unassigned » a fusionné
    // avec celle-ci (paramètre includeNullState du RPC).
    queryClient.invalidateQueries({ queryKey: ["mailbox-couriers"] });
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

  const serviceFilter = useUserServiceFilter();
  const debouncedSearch = useDebouncedValue(search, 300);

  // Une seule requête là où il y en avait deux (états initiaux + état NULL),
  // fusionnées puis retriées en JS sur 100 lignes chacune : le tri combiné
  // n'était donc pas celui des 200 courriers les plus récents.
  // COALESCE(received_at, created_at) côté SQL reproduit le repli de l'ancien tri.
  const filters = useMemo<CourierListFilters | null>(() => {
    if (!organizationId || !initialStateIds?.length) return null;
    return {
      organizationId,
      direction: "inbound",
      workflowStateIds: initialStateIds,
      includeNullState: true,
      keywords: debouncedSearch || null,
      prefixMatch: true,
      visibleSocleOrganizationIds: serviceFilter,
      // Onglet « Transférés » : filtre serveur, et non plus un partage de la
      // page en deux tableaux — paginé, ce partage n'aurait montré que les
      // transférés de la page courante.
      transferredOnly: tab === "transferred" ? true : null,
    };
  }, [organizationId, initialStateIds, debouncedSearch, serviceFilter, tab]);

  const list = useCourierList(filters, {
    queryKeyPrefix: "mailbox-couriers",
    defaultSort: { key: "received_at", dir: "desc" },
  });

  // Cette page compose sa propre <Table> (colonne « nouveau », icônes de
  // transfert et de volume) plutôt que d'utiliser DataTable : elle pilote donc
  // le tri à la main, via le même état serveur que les autres listes.
  function toggleSort(key: CourierSortKey, descFirst: boolean) {
    const current = list.sorting[0];
    const desc = current?.id === key ? !current.desc : descFirst;
    list.onSortingChange([{ id: key, desc }]);
  }

  function sortDirection(key: CourierSortKey): SortDirection {
    const current = list.sorting[0];
    if (current?.id !== key) return false;
    return current.desc ? "desc" : "asc";
  }

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

  function isNew(courier: CourierListRow): boolean {
    if (!lastLogin) return false;
    const receivedAt = courier.received_at ?? courier.created_at;
    return new Date(receivedAt) > new Date(lastLogin);
  }

  // Arrivé pendant que l'utilisateur est sur cette page (via cron)
  function isNewThisSession(courier: CourierListRow): boolean {
    const receivedAt = courier.received_at ?? courier.created_at;
    return new Date(receivedAt) > new Date(pageOpenTime.current);
  }

  function getSender(courier: CourierListRow): { last: string; first: string } {
    // Le RPC renvoie nom et prénom séparément, précisément pour cette colonne.
    return {
      last: courier.sender_last_name ?? courier.sender_name ?? "—",
      first: courier.sender_first_name ?? "—",
    };
  }

  // Le panneau latéral attend un CourierWithRelations complet, que le RPC ne
  // produit pas. On réutilise le chemin `pendingOpenId` déjà présent, qui
  // recharge le courrier par identifiant : un aller-retour de plus au clic, et
  // le panneau reçoit un enregistrement plus riche (documents, événements).
  function handleRowClick(courier: CourierListRow) {
    setPendingOpenId(courier.id);
  }

  function renderRow(c: CourierListRow) {
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
          <span className="inline-flex items-center gap-1.5">
            {/* Remplace l'encadré « Courriers transférés » : l'information reste
                visible ligne par ligne, y compris dans l'onglet « Tous ». */}
            {c.is_transferred && (
              <ArrowRightLeft
                className="h-3.5 w-3.5 shrink-0 text-secondary"
                aria-label="Courrier transféré"
              />
            )}
            {/* Ces courriers étaient auparavant rejetés à l'ingestion (limite
                2 Mo). Ils entrent désormais, mais restent signalés : ce sont le
                plus souvent des numérisations, longues à ouvrir et à analyser. */}
            {c.is_large_email && (
              <Weight
                className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                aria-label="Courrier volumineux"
              />
            )}
            {c.subject ?? "Sans titre"}
          </span>
        </TableCell>
        <TableCell className="text-sm font-medium">{c.recipient_name ?? "—"}</TableCell>
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
        {organizationId && canEdit && (
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
      ) : (
        <div className="space-y-4">
          {/* Les transférés étaient auparavant un second tableau, alimenté par un
              partage client de la liste. Devenu un filtre serveur : paginé, un
              partage n'aurait montré que les transférés de la page courante. */}
          <Tabs value={tab} onValueChange={(v) => setTab(v as "all" | "transferred")}>
            <TabsList>
              <TabsTrigger value="all">Tous</TabsTrigger>
              <TabsTrigger value="transferred">
                <ArrowRightLeft className="h-4 w-4 mr-1.5" />
                Transférés
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <Card>
            {list.isLoading ? (
              <CardContent className="py-8 text-center text-muted-foreground">Chargement…</CardContent>
            ) : !list.rows.length ? (
              <CardContent className="py-8 text-center text-muted-foreground">
                {tab === "transferred"
                  ? "Aucun courrier transféré."
                  : "Aucun courrier en attente dans la boîte aux lettres."}
              </CardContent>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10"></TableHead>
                    <TableHead aria-sort={ariaSort(sortDirection("received_at"))}>
                      <SortableHeader
                        title="Date de réception"
                        direction={sortDirection("received_at")}
                        onToggle={() => toggleSort("received_at", true)}
                      />
                    </TableHead>
                    <TableHead aria-sort={ariaSort(sortDirection("subject"))}>
                      <SortableHeader
                        title="Objet"
                        direction={sortDirection("subject")}
                        onToggle={() => toggleSort("subject", false)}
                      />
                    </TableHead>
                    {/* Destinataire et expéditeur ne sont pas triables : le RPC
                        les tire de courier_participants APRÈS le découpage, sur
                        la seule page retenue. */}
                    <TableHead>Destinataire</TableHead>
                    <TableHead>Nom expéditeur</TableHead>
                    <TableHead>Prénom expéditeur</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>{list.rows.map((c) => renderRow(c))}</TableBody>
              </Table>
            )}
            <DataTablePagination
              page={list.page}
              pageCount={list.pageCount}
              pageSize={list.pageSize}
              totalCount={list.totalCount}
              onPageChange={list.setPage}
              onPageSizeChange={list.setPageSize}
              isLoading={list.isFetching}
            />
          </Card>
        </div>
      )}

      {/* Side panel */}
      {organizationId && (
        <MailboxSidePanel
          courier={selectedCourier}
          open={panelOpen}
          onOpenChange={setPanelOpen}
          organizationId={organizationId}
          onDelete={(c) => setCourierToDelete(c as unknown as CourierListRow)}
        />
      )}

      {/* New courier dialog */}
      {organizationId && (
        <NewCourierDialog
          open={newDialogOpen}
          onOpenChange={setNewDialogOpen}
          organizationId={organizationId}
          onCreated={(id) => setPendingOpenId(id)}
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
