import { useState, useMemo, useEffect, useRef } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { ArrowRightLeft, ChevronRight, Sparkles, Weight } from "lucide-react";
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
import { useCourierList } from "@/hooks/useCourierList";
import { useCourierFacets } from "@/hooks/useCourierFacets";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { DataTablePagination } from "@/components/data-table/data-table-pagination";
import { SortableHeader, type SortDirection } from "@/components/data-table/data-table-column-header";
import { LIST_HEADER_SURFACE, ListCellDate, ListCellText, ListCellTitle } from "@/components/list/ListCells";
import { ListActiveFilters, ListFilterButton } from "@/components/list/ListFilters";
import {
  ListDensityToggle,
  ListMessage,
  ListPage,
  ListSegmented,
  ListToolbar,
} from "@/components/list/ListPage";
import { ListScrollArea } from "@/components/list/ListScrollArea";
import { CourierFacetFields } from "@/components/courier/CourierFacetFields";
import { courierSenderName } from "@/components/courier/courierListColumns";
import { toast } from "@/hooks/use-toast";
import MailboxSidePanel from "@/components/courier/MailboxSidePanel";
import AddCourierMenu from "@/components/courier/AddCourierMenu";
import NewCourierDialog from "@/components/courier/NewCourierDialog";
import MailboxOrganizationSelect from "@/components/courier/MailboxOrganizationSelect";
import { UNASSIGNED_ORGANIZATION, useMailboxOrganization } from "@/hooks/useMailboxOrganization";
import mailboxIcon from "@/assets/icons/mailbox.svg";
import type { CourierWithRelations } from "@/types/courier";
import { TRASH_RETENTION_DAYS } from "@/lib/trash";

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
  "grid grid-cols-[minmax(0,1fr)_28px] items-center gap-3 md:grid-cols-[104px_minmax(0,1fr)_160px_28px]";

/**
 * `lg:` de Tailwind — la largeur à partir de laquelle la liste et le panneau
 * tiennent côte à côte. En dessous, le panneau n'est pas rendu du tout : un
 * courrier n'y serait lisible qu'au prix d'un long défilement sous la liste.
 * La boîte se réduit alors à sa liste, et un courrier s'ouvre dans sa page
 * dédiée — le geste des autres listes de courriers.
 */
const SPLIT_VIEW_QUERY = "(min-width: 1024px)";

export default function BoiteAuxLettres() {
  const { organizationId } = useOrganization();
  const { profile, membership } = useAuth();
  const canEdit = canEditCouriers(profile, membership);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [courierToDelete, setCourierToDelete] = useState<CourierListRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [tab, setTab] = useState<"all" | "transferred">("all");
  const splitView = useMediaQuery(SPLIT_VIEW_QUERY);

  async function handleConfirmDelete() {
    if (!organizationId || !courierToDelete) return;
    setDeleting(true);
    const { error } = await deleteCourier(organizationId, courierToDelete.id);
    setDeleting(false);
    if (error) {
      toast({ title: "Suppression impossible", description: error.message, variant: "destructive" });
      return;
    }
    toast({
      title: "Courrier placé dans la corbeille",
      description: `Il pourra être restauré pendant ${TRASH_RETENTION_DAYS} jours.`,
    });
    if (selectedCourier?.id === courierToDelete.id) {
      setSelectedCourier(null);
    }
    setCourierToDelete(null);
    // Une seule clé désormais : la requête « mailbox-unassigned » a fusionné
    // avec celle-ci (paramètre includeNullState du RPC).
    queryClient.invalidateQueries({ queryKey: ["mailbox-couriers"] });
    queryClient.invalidateQueries({ queryKey: ["trash-couriers"] });
  }
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
  // La boîte se lit par bannette : une organisation, ou les courriers sans
  // service désigné — jamais tous les courriers mélangés.
  const mailbox = useMailboxOrganization(organizationId, initialStateIds, serviceFilter);
  const unassignedBin = mailbox.selected === UNASSIGNED_ORGANIZATION;
  // Pas d'autre filtre dans la boîte : son panneau ne porte que la recherche,
  // qui y rejoint celle des autres listes de courriers.
  const facets = useCourierFacets({});

  // Changer de bannette vide le panneau : le courrier ouvert n'y figure plus,
  // et la sélection d'office reprend le premier de la nouvelle liste. Pas au
  // premier choix de bannette : un courrier ouvert par `?open=` resterait sinon
  // fermé aussitôt.
  const previousBinRef = useRef<string | null>(null);
  useEffect(() => {
    if (previousBinRef.current && previousBinRef.current !== mailbox.selected) {
      setSelectedCourier(null);
    }
    previousBinRef.current = mailbox.selected;
  }, [mailbox.selected]);

  // Une seule requête là où il y en avait deux (états initiaux + état NULL),
  // fusionnées puis retriées en JS sur 100 lignes chacune : le tri combiné
  // n'était donc pas celui des 200 courriers les plus récents.
  // COALESCE(received_at, created_at) côté SQL reproduit le repli de l'ancien tri.
  const filters = useMemo<CourierListFilters | null>(() => {
    if (!organizationId || !initialStateIds?.length || !mailbox.selected) return null;
    return {
      organizationId,
      direction: "inbound",
      workflowStateIds: initialStateIds,
      includeNullState: true,
      keywords: facets.keywords || null,
      prefixMatch: true,
      socleOrganizationId: unassignedBin ? null : mailbox.selected,
      // Bannette « sans service désigné » : le RPC laisse toujours passer les
      // courriers sans organisation, et un périmètre vide écarte tous les
      // autres — il ne reste qu'eux. Ailleurs, le périmètre RBAC habituel.
      visibleSocleOrganizationIds: unassignedBin ? [] : serviceFilter,
      // Onglet « Transférés » : filtre serveur, et non plus un partage de la
      // page en deux tableaux — paginé, ce partage n'aurait montré que les
      // transférés de la page courante.
      transferredOnly: tab === "transferred" ? true : null,
    };
  }, [organizationId, initialStateIds, mailbox.selected, unassignedBin, facets.keywords, serviceFilter, tab]);

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
    return (
      <SortableHeader
        title={label}
        direction={sortDirection(sortKey)}
        onToggle={() => toggleSort(sortKey, descFirst)}
      />
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

    // Sans panneau, le courrier s'ouvre dans sa page dédiée. La règle est ici
    // plutôt que sur le clic pour valoir aussi pour les deux autres chemins
    // d'ouverture : le lien `?open=` d'une notification et la création.
    if (!splitView) {
      setPendingOpenId(null);
      navigate(`/courrier/${pendingOpenId}`);
      return;
    }

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
  }, [pendingOpenId, organizationId, splitView, navigate]);

  // Premier courrier sélectionné d'office : le panneau de droite n'a de sens
  // que rempli, et le tri met en tête celui qu'on veut traiter. Le ref retient
  // la tentative : sans lui, un courrier que la requête par identifiant ne
  // rend pas (droits, suppression concurrente) serait redemandé sans fin.
  // Sous `lg`, pas de sélection d'office : elle ouvrirait la page du premier
  // courrier avant même que l'utilisateur ait lu la liste.
  const autoSelectedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!splitView || selectedCourier || pendingOpenId || !list.rows.length) return;
    const first = list.rows[0].id;
    if (autoSelectedRef.current === first) return;
    autoSelectedRef.current = first;
    setPendingOpenId(first);
  }, [splitView, list.rows, selectedCourier, pendingOpenId]);

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
  // reçoit un enregistrement plus riche (documents, événements). Sans panneau,
  // ce même chemin redirige vers la page dédiée du courrier.
  function handleRowClick(courier: CourierListRow) {
    setPendingOpenId(courier.id);
  }

  function renderRow(c: CourierListRow) {
    const isNewCourier = isNew(c);
    const isJustArrived = isNewThisSession(c);
    const selected = selectedCourier?.id === c.id;
    const senderName = courierSenderName(c);
    const newMark = isNewCourier && (
      <Sparkles
        className={cn(
          "h-3.5 w-3.5 shrink-0",
          isJustArrived ? "animate-pulse text-secondary" : "text-secondary/70",
        )}
        aria-label={isJustArrived ? "Arrivé à l'instant" : "Nouveau depuis votre dernière visite"}
      />
    );
    return (
      <button
        key={c.id}
        type="button"
        onClick={() => handleRowClick(c)}
        aria-current={selected}
        className={cn(
          ROW_GRID,
          "min-h-12 w-full border-b border-l-[3px] border-b-border/70 px-4 py-1.5 text-left transition-colors group-data-[density=compact]/list:min-h-9 group-data-[density=compact]/list:py-1",
          selected
            ? "border-l-primary bg-primary/[0.06]"
            : "border-l-transparent hover:bg-muted/55",
        )}
      >
        <span className="hidden items-center gap-1.5 md:flex">
          {newMark}
          <ListCellDate value={c.received_at} />
        </span>

        <ListCellTitle
          title={c.subject ?? "Sans titre"}
          leading={
            <>
              <span className="md:hidden">{newMark}</span>
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
            </>
          }
          meta={
            <>
              {/* Sous `md`, date et expéditeur n'ont pas de colonne : ils
                  passent dans la ligne de contexte. */}
              <span className="md:hidden">
                {[c.received_at ? new Date(c.received_at).toLocaleDateString("fr-FR") : null, senderName]
                  .filter(Boolean)
                  .join(" · ") || "—"}
              </span>
              <span className="hidden md:inline">{c.assigned_service ?? "Non assigné"}</span>
            </>
          }
        />

        <ListCellText className="hidden text-foreground md:block">{senderName || "—"}</ListCellText>

        <ChevronRight
          className={cn("h-4 w-4 justify-self-center", selected ? "text-primary" : "text-muted-foreground/60")}
        />
      </button>
    );
  }

  return (
    <ListPage>
      <ListToolbar
        icon={<img src={mailboxIcon} alt="" style={{ filter: "var(--icon-primary-filter, none)" }} />}
        title="À instruire"
        count={list.filters && !list.isLoading ? list.totalCount : null}
        countLabel="courriers en attente"
        titleAside={
          organizationId ? (
            <MailboxOrganizationSelect
              options={mailbox.options}
              value={mailbox.selected}
              onChange={mailbox.select}
            />
          ) : undefined
        }
        primary={
          organizationId && canEdit ? (
            <AddCourierMenu onNewCourier={() => setNewDialogOpen(true)} />
          ) : undefined
        }
      >
        {/* Les transférés étaient auparavant un second tableau, alimenté par
            un partage client de la liste. Devenu un filtre serveur : paginé,
            un partage n'aurait montré que les transférés de la page courante. */}
        <ListSegmented<"all" | "transferred">
          value={tab}
          onChange={setTab}
          ariaLabel="Filtre"
          options={[
            { value: "all", label: "Tous" },
            { value: "transferred", label: "Transférés", icon: <ArrowRightLeft /> },
          ]}
        />
        <ListFilterButton
          title="Filtrer les courriers"
          activeCount={facets.activeCount}
          resultLabel={list.isFetching ? "…" : `${list.totalCount} résultat${list.totalCount > 1 ? "s" : ""}`}
          onReset={facets.reset}
        >
          <CourierFacetFields facets={facets} />
        </ListFilterButton>
        <ListDensityToggle />
      </ListToolbar>

      {!organizationId ? (
        <ListMessage>Veuillez sélectionner une organisation pour voir les courriers.</ListMessage>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          {/* Sur grand écran la liste occupe la hauteur disponible : seules les
              lignes défilent, entre un en-tête et une pagination qui restent en
              place. */}
          <section aria-label="Courriers en attente" className="flex min-h-0 min-w-0 flex-1 flex-col">
            {/* Au-dessus de la liste seule : la recherche ne touche pas au panneau. */}
            <ListActiveFilters chips={facets.chips} onReset={facets.reset} />
            {!list.isLoading && list.rows.length > 0 && (
              /* Le tri par colonne est une affordance de bureau : sous `md`
                 la liste garde son ordre par défaut (plus récents d'abord). */
              <div
                className={cn(
                  ROW_GRID,
                  LIST_HEADER_SURFACE,
                  "hidden h-[38px] shrink-0 border-b border-l-[3px] border-l-transparent px-4 text-xs font-semibold text-muted-foreground md:grid",
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
            <ListScrollArea resetKey={`${list.page}:${list.pageSize}`}>
              {list.isLoading || !list.filters ? (
                <ListMessage>Chargement…</ListMessage>
              ) : !list.rows.length ? (
                <ListMessage>
                  {facets.activeCount
                    ? "Aucun courrier en attente ne correspond à cette recherche."
                    : tab === "transferred"
                      ? "Aucun courrier transféré."
                      : unassignedBin
                        ? "Aucun courrier en attente sans service désigné."
                        : "Aucun courrier en attente pour cette organisation."}
                </ListMessage>
              ) : (
                list.rows.map((c) => renderRow(c))
              )}
            </ListScrollArea>
            <DataTablePagination
              page={list.page}
              pageCount={list.pageCount}
              pageSize={list.pageSize}
              totalCount={list.totalCount}
              onPageChange={list.setPage}
              onPageSizeChange={list.setPageSize}
              isLoading={list.isFetching}
            />
          </section>

          {/* Le panneau n'existe qu'à partir de `lg`, et sa media query fait foi :
              caché en CSS, il resterait monté — il chargerait le courrier et son
              aperçu pour un écran qui ne les montre pas.
              La hauteur vient du conteneur, pas de `100dvh` : ce gabarit retranchait
              l'en-tête mais pas le pied de page, et les derniers pixels du panneau
              tombaient sous la ligne de flottaison, hors d'atteinte du défilement.
              Le panneau n'est plus posé dans une colonne flex non plus : la carte,
              qui rogne son propre débordement, se laissait comprimer par la
              colonne au lieu de faire défiler le panneau — sa fin restait alors
              inatteignable, quel que soit le défilement. */}
          {splitView && (
            <aside
              className="w-[440px] min-w-0 shrink-0 overflow-y-auto border-l bg-background p-4 xl:w-[520px]"
              aria-label="Courrier sélectionné"
            >
              <MailboxSidePanel
                courier={selectedCourier}
                organizationId={organizationId}
                onClose={() => setSelectedCourier(null)}
                onDelete={(c) => setCourierToDelete(c as unknown as CourierListRow)}
              />
            </aside>
          )}
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
              Le courrier
              {courierToDelete?.subject ? ` « ${courierToDelete.subject} »` : ""} sera placé
              dans la corbeille, avec ses réponses. Il pourra être restauré pendant {TRASH_RETENTION_DAYS} jours.
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
    </ListPage>
  );
}
