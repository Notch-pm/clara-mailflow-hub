import { useState, useMemo, useEffect, useRef } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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
import {
  ArrowDown,
  ArrowRightLeft,
  ArrowUp,
  ChevronRight,
  Plus,
  Search,
  Sparkles,
  Upload,
  Weight,
} from "lucide-react";
import { useOrganization } from "@/contexts/OrganizationContext";
import { useAuth } from "@/contexts/AuthContext";
import { canEditCouriers } from "@/lib/permissions";
import { cn } from "@/lib/utils";
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
import { type SortDirection } from "@/components/data-table/data-table-column-header";
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

/**
 * Gabarit de colonnes partagé par l'en-tête et les lignes de la liste. Sous
 * `md`, la place manque pour quatre colonnes : date et expéditeur passent sous
 * l'objet, en ligne de contexte.
 */
const ROW_GRID =
  "grid grid-cols-[minmax(0,1fr)_28px] items-center gap-3 md:grid-cols-[92px_minmax(0,1fr)_130px_28px]";

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
      setSelectedCourier(null);
    }
    setCourierToDelete(null);
    // Une seule clé désormais : la requête « mailbox-unassigned » a fusionné
    // avec celle-ci (paramètre includeNullState du RPC).
    queryClient.invalidateQueries({ queryKey: ["mailbox-couriers"] });
  }
  const [search, setSearch] = useState("");
  const [selectedCourier, setSelectedCourier] = useState<CourierWithRelations | null>(null);
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

  // La liste est une maîtresse-détail, pas un tableau : elle pilote son tri à
  // la main, via le même état serveur que les autres listes.
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

  /** En-tête de colonne triable de la liste. */
  function SortButton({ label, sortKey, descFirst }: { label: string; sortKey: CourierSortKey; descFirst: boolean }) {
    const dir = sortDirection(sortKey);
    return (
      <button
        type="button"
        onClick={() => toggleSort(sortKey, descFirst)}
        aria-label={`Trier par ${label.toLowerCase()}`}
        className={cn(
          "inline-flex items-center gap-1 transition-colors hover:text-foreground",
          dir && "text-foreground",
        )}
      >
        {label}
        {dir === "asc" ? (
          <ArrowUp className="h-3 w-3" />
        ) : dir === "desc" ? (
          <ArrowDown className="h-3 w-3" />
        ) : null}
      </button>
    );
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
        if (data) setSelectedCourier(data as CourierWithRelations);
        setPendingOpenId(null);
      });
    return () => { cancelled = true; };
  }, [pendingOpenId, organizationId]);

  // Premier courrier sélectionné d'office : le panneau de droite n'a de sens
  // que rempli, et le tri met en tête celui qu'on veut traiter. Le ref retient
  // la tentative : sans lui, un courrier que la requête par identifiant ne
  // rend pas (droits, suppression concurrente) serait redemandé sans fin.
  const autoSelectedRef = useRef<string | null>(null);
  useEffect(() => {
    if (selectedCourier || pendingOpenId || !list.rows.length) return;
    const first = list.rows[0].id;
    if (autoSelectedRef.current === first) return;
    autoSelectedRef.current = first;
    setPendingOpenId(first);
  }, [list.rows, selectedCourier, pendingOpenId]);

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

  // Le panneau attend un CourierWithRelations complet, que le RPC ne produit
  // pas. On réutilise le chemin `pendingOpenId` déjà présent, qui recharge le
  // courrier par identifiant : un aller-retour de plus au clic, et le panneau
  // reçoit un enregistrement plus riche (documents, événements).
  function handleRowClick(courier: CourierListRow) {
    setPendingOpenId(courier.id);
  }

  function renderRow(c: CourierListRow) {
    const isNewCourier = isNew(c);
    const isJustArrived = isNewThisSession(c);
    const selected = selectedCourier?.id === c.id;
    const senderName = c.sender_name ?? [c.sender_last_name, c.sender_first_name].filter(Boolean).join(" ");
    return (
      <button
        key={c.id}
        type="button"
        onClick={() => handleRowClick(c)}
        aria-current={selected}
        className={cn(
          ROW_GRID,
          "w-full border-b border-l-[3px] border-border px-4 py-3.5 text-left transition-colors last:border-b-0",
          selected
            ? "border-l-primary bg-primary/[0.06]"
            : "border-l-transparent hover:bg-muted/50",
        )}
      >
        <span className="hidden items-center gap-1.5 text-sm tabular-nums text-muted-foreground md:flex">
          {isNewCourier && (
            <Sparkles
              className={cn(
                "h-3.5 w-3.5 shrink-0",
                isJustArrived ? "animate-pulse text-secondary" : "text-secondary/70",
              )}
              aria-label={isJustArrived ? "Arrivé à l'instant" : "Nouveau depuis votre dernière visite"}
            />
          )}
          {c.received_at ? new Date(c.received_at).toLocaleDateString("fr-FR") : "—"}
        </span>

        <span className="min-w-0">
          {c.assigned_service && (
            <span className="mb-0.5 block truncate text-xs font-bold text-primary">
              {c.assigned_service}
            </span>
          )}
          <span className="flex min-w-0 items-center gap-1.5">
            {isNewCourier && (
              <Sparkles
                className={cn(
                  "h-3.5 w-3.5 shrink-0 md:hidden",
                  isJustArrived ? "animate-pulse text-secondary" : "text-secondary/70",
                )}
                aria-label={isJustArrived ? "Arrivé à l'instant" : "Nouveau depuis votre dernière visite"}
              />
            )}
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
            <span className="truncate text-sm font-semibold">{c.subject ?? "Sans titre"}</span>
          </span>
          <span className="mt-0.5 block truncate text-xs text-muted-foreground md:hidden">
            {[c.received_at ? new Date(c.received_at).toLocaleDateString("fr-FR") : null, senderName]
              .filter(Boolean)
              .join(" · ") || "—"}
          </span>
        </span>

        <span className="hidden truncate text-sm md:block">{senderName || "—"}</span>

        <ChevronRight
          className={cn("h-4 w-4 justify-self-center", selected ? "text-primary" : "text-border")}
        />
      </button>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col px-4 py-5 pb-8 md:px-6 lg:h-full lg:pb-5">
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-end gap-4 lg:shrink-0">
        <div className="flex min-w-0 flex-1 basis-[320px] items-center gap-3">
          <img
            src={mailboxIcon}
            alt=""
            className="h-6 w-6 text-primary"
            style={{ filter: "var(--icon-primary-filter, none)" }}
          />
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight">Boîte aux lettres</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Retrouvez ici les courriers reçus en attente de prise en charge.
            </p>
          </div>
        </div>
        {organizationId && canEdit && (
          <div className="flex items-center gap-2.5">
            <Button variant="outline" className="h-10 gap-2" onClick={() => navigate("/import-en-masse")}>
              <Upload className="h-4 w-4" />
              Importer en masse
            </Button>
            <Button className="h-10 gap-2 font-bold" onClick={() => setNewDialogOpen(true)}>
              <Plus className="h-4 w-4" />
              Nouveau courrier
            </Button>
          </div>
        )}
      </div>

      {!organizationId ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Veuillez sélectionner une organisation pour voir les courriers.
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-wrap items-start gap-5 lg:min-h-0 lg:flex-1 lg:flex-nowrap lg:items-stretch">
          <section className="flex min-w-0 flex-1 basis-[620px] flex-col gap-3.5 lg:min-h-0">
            <div className="flex flex-wrap items-center gap-3 lg:shrink-0">
              <div className="relative min-w-0 max-w-[360px] flex-1 basis-[260px]">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Rechercher par objet…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-11 pl-9"
                />
              </div>
              {/* Les transférés étaient auparavant un second tableau, alimenté par
                  un partage client de la liste. Devenu un filtre serveur : paginé,
                  un partage n'aurait montré que les transférés de la page courante. */}
              <div className="flex rounded-full bg-muted p-1" role="tablist" aria-label="Filtre">
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === "all"}
                  onClick={() => setTab("all")}
                  className={cn(
                    "h-[34px] rounded-full px-4 text-sm font-bold transition-colors",
                    tab === "all"
                      ? "bg-card shadow-airbnb-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Tous
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === "transferred"}
                  onClick={() => setTab("transferred")}
                  className={cn(
                    "inline-flex h-[34px] items-center gap-1.5 rounded-full px-4 text-sm font-semibold transition-colors",
                    tab === "transferred"
                      ? "bg-card font-bold shadow-airbnb-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <ArrowRightLeft className="h-3.5 w-3.5" />
                  Transférés
                </button>
              </div>
              <div className="flex-1" />
              <span className="text-sm text-muted-foreground">
                {list.totalCount} courrier{list.totalCount > 1 ? "s" : ""} en attente
              </span>
            </div>

            {/* Sur grand écran le cadre occupe la hauteur disponible : seules les
                lignes défilent, entre un en-tête et une pagination qui restent en
                place. */}
            <Card className="flex flex-col overflow-hidden p-0 shadow-airbnb-sm lg:min-h-0 lg:flex-1">
              {!list.isLoading && list.rows.length > 0 && (
                /* Le tri par colonne est une affordance de bureau : sous `md`
                   la liste garde son ordre par défaut (plus récents d'abord). */
                <div
                  className={cn(
                    ROW_GRID,
                    "hidden shrink-0 border-b border-l-[3px] border-l-transparent bg-muted/50 px-4 py-3 text-xs font-bold text-muted-foreground md:grid",
                  )}
                >
                  <SortButton label="Réception" sortKey="received_at" descFirst />
                  <SortButton label="Objet" sortKey="subject" descFirst={false} />
                  {/* Expéditeur n'est pas triable : le RPC le tire de
                      courier_participants APRÈS le découpage, sur la seule
                      page retenue. */}
                  <span>Expéditeur</span>
                  <span />
                </div>
              )}
              <div className="min-h-0 flex-1 lg:overflow-y-auto">
                {list.isLoading ? (
                  <div className="py-8 text-center text-sm text-muted-foreground">Chargement…</div>
                ) : !list.rows.length ? (
                  <div className="py-8 text-center text-sm text-muted-foreground">
                    {tab === "transferred"
                      ? "Aucun courrier transféré."
                      : "Aucun courrier en attente dans la boîte aux lettres."}
                  </div>
                ) : (
                  list.rows.map((c) => renderRow(c))
                )}
              </div>
              <div className="shrink-0">
                <DataTablePagination
                  page={list.page}
                  pageCount={list.pageCount}
                  pageSize={list.pageSize}
                  totalCount={list.totalCount}
                  onPageChange={list.setPage}
                  onPageSizeChange={list.setPageSize}
                  isLoading={list.isFetching}
                />
              </div>
            </Card>
          </section>

          {/* La hauteur vient du conteneur, pas de `100dvh` : ce gabarit retranchait
              l'en-tête mais pas le pied de page, et les derniers pixels du panneau
              tombaient sous la ligne de flottaison, hors d'atteinte du défilement.
              Le panneau n'est plus posé dans une colonne flex non plus : la carte,
              qui rogne son propre débordement, se laissait comprimer par la
              colonne au lieu de faire défiler le panneau — sa fin restait alors
              inatteignable, quel que soit le défilement. */}
          <aside
            className="w-full min-w-0 flex-1 basis-[420px] lg:min-h-0 lg:max-w-[520px] lg:overflow-y-auto lg:pb-2"
            aria-label="Courrier sélectionné"
          >
            <MailboxSidePanel
              courier={selectedCourier}
              organizationId={organizationId}
              onClose={() => setSelectedCourier(null)}
              onDelete={(c) => setCourierToDelete(c as unknown as CourierListRow)}
            />
          </aside>
        </div>
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
