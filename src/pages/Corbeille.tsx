import { useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { RotateCcw, Trash2 } from "lucide-react";
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
import { DataTable } from "@/components/data-table/data-table";
import { ListCellDate, ListCellText, ListCellTitle } from "@/components/list/ListCells";
import { ListDensityToggle, ListMessage, ListPage, ListSearch, ListToolbar } from "@/components/list/ListPage";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/contexts/OrganizationContext";
import { channelLabels } from "@/hooks/useCourierWorkspace";
import { canAccessMailroom, canEditCouriers } from "@/lib/permissions";
import { daysUntilPurge, purgeLabel, TRASH_RETENTION_DAYS } from "@/lib/trash";
import {
  emptyTrash,
  fetchTrashedCouriers,
  purgeTrashedCourier,
  restoreCourier,
  type TrashRow,
} from "@/services/trashService";

/**
 * Listes en cache qui retrouvent un courrier restauré. Les autres se relisent
 * d'elles-mêmes au retour sur leur page (staleTime 0).
 */
const RESTORED_INTO = ["mailroom-couriers", "mailbox-couriers", "dashboard-inbound"];

type Confirm = { kind: "purge"; row: TrashRow } | { kind: "empty" } | null;

/**
 * « Corbeille et spam » — écran du gestionnaire courrier. Les courriers
 * supprimés y restent {@link TRASH_RETENTION_DAYS} jours : restaurables, ou
 * supprimés définitivement (un par un, ou en vidant la corbeille). Au-delà, la
 * purge nocturne les efface d'elle-même.
 */
export default function Corbeille() {
  const { organizationId } = useOrganization();
  const { profile, membership, profileLoaded } = useAuth();
  const canEdit = canEditCouriers(profile, membership);
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [confirm, setConfirm] = useState<Confirm>(null);

  const trash = useQuery({
    queryKey: ["trash-couriers", organizationId],
    queryFn: () => fetchTrashedCouriers(organizationId!),
    enabled: !!organizationId && canAccessMailroom(profile, membership),
  });

  const refresh = (restored = false) => {
    queryClient.invalidateQueries({ queryKey: ["trash-couriers"] });
    if (restored) RESTORED_INTO.forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));
  };

  const restore = useMutation({
    mutationFn: (row: TrashRow) => restoreCourier(organizationId!, row.id),
    onSuccess: () => {
      refresh(true);
      toast.success("Courrier restauré", { description: "Il a retrouvé sa place dans les listes." });
    },
    onError: (err: Error) => toast.error("Restauration impossible", { description: err.message }),
  });

  const purge = useMutation({
    mutationFn: (row: TrashRow) => purgeTrashedCourier(organizationId!, row.id),
    onSuccess: () => {
      refresh();
      toast.success("Courrier supprimé définitivement");
    },
    onError: (err: Error) => toast.error("Suppression impossible", { description: err.message }),
    onSettled: () => setConfirm(null),
  });

  const empty = useMutation({
    mutationFn: () => emptyTrash(organizationId!),
    onSuccess: (count) => {
      refresh();
      toast.success("Corbeille vidée", {
        description: `${count} courrier${count > 1 ? "s" : ""} supprimé${count > 1 ? "s" : ""} définitivement.`,
      });
    },
    onError: (err: Error) => toast.error("Impossible de vider la corbeille", { description: err.message }),
    onSettled: () => setConfirm(null),
  });

  const rows = useMemo(() => {
    const all = trash.data ?? [];
    const q = query.trim().toLocaleLowerCase("fr");
    if (!q) return all;
    return all.filter((r) =>
      [r.subject, r.sender_name, r.chrono].some((v) => v?.toLocaleLowerCase("fr").includes(q)),
    );
  }, [trash.data, query]);

  const busy = restore.isPending || purge.isPending || empty.isPending;

  const columns = useMemo<ColumnDef<TrashRow>[]>(
    () => [
      {
        accessorKey: "chrono",
        header: "Chrono",
        cell: ({ row }) => (
          <span className="block truncate font-mono text-xs tabular-nums text-muted-foreground">
            {row.original.chrono ?? "—"}
          </span>
        ),
        meta: { width: 112 },
      },
      {
        accessorKey: "subject",
        header: "Objet",
        cell: ({ row }) => {
          const r = row.original;
          const replies = r.reply_count ? ` · ${r.reply_count} réponse${r.reply_count > 1 ? "s" : ""}` : "";
          return <ListCellTitle title={r.subject || "Sans objet"} meta={`${r.sender_name || "Expéditeur inconnu"}${replies}`} />;
        },
        meta: { minWidth: 260 },
      },
      {
        accessorKey: "channel",
        header: "Canal",
        cell: ({ row }) => (
          <ListCellText>{channelLabels[row.original.channel as keyof typeof channelLabels] ?? row.original.channel}</ListCellText>
        ),
        meta: { width: 96 },
      },
      {
        accessorKey: "received_at",
        header: "Reçu le",
        cell: ({ row }) => <ListCellDate value={row.original.received_at ?? row.original.created_at} />,
        meta: { width: 104 },
      },
      {
        accessorKey: "deleted_at",
        header: "Supprimé",
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-col gap-0.5">
            <ListCellDate value={row.original.deleted_at} />
            {row.original.deleted_by_name && <ListCellText className="text-xs">par {row.original.deleted_by_name}</ListCellText>}
          </div>
        ),
        meta: { width: 150 },
      },
      {
        accessorKey: "purge_at",
        header: "Suppression définitive",
        cell: ({ row }) => {
          const days = daysUntilPurge(row.original.purge_at);
          return <ListCellText className={days <= 3 ? "font-semibold text-destructive" : undefined}>{purgeLabel(days)}</ListCellText>;
        },
        meta: { width: 168 },
      },
      ...(canEdit
        ? [
            {
              id: "actions",
              header: () => <span className="sr-only">Actions</span>,
              cell: ({ row }) => (
                <div className="flex items-center justify-end gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5"
                    disabled={busy}
                    onClick={() => restore.mutate(row.original)}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Restaurer
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:border-destructive/35 hover:bg-destructive/5 hover:text-destructive"
                    title="Supprimer définitivement"
                    aria-label="Supprimer définitivement"
                    disabled={busy}
                    onClick={() => setConfirm({ kind: "purge", row: row.original })}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ),
              meta: { width: 168, align: "right" },
            } satisfies ColumnDef<TrashRow>,
          ]
        : []),
    ],
    [canEdit, busy, restore],
  );

  if (profileLoaded && !canAccessMailroom(profile, membership)) return <Navigate to="/boite-aux-lettres" replace />;

  const total = trash.data?.length ?? 0;

  return (
    <ListPage>
      <ListToolbar
        icon={<Trash2 />}
        title="Corbeille et spam"
        count={trash.isLoading ? null : total}
        countLabel={total > 1 ? "courriers" : "courrier"}
        search={<ListSearch value={query} onChange={setQuery} placeholder="Rechercher un courrier, un expéditeur…" />}
        primary={
          canEdit ? (
            <Button
              size="sm"
              variant="destructive"
              className="h-9 gap-1.5 font-bold"
              disabled={!total || busy}
              onClick={() => setConfirm({ kind: "empty" })}
            >
              <Trash2 className="h-4 w-4" />
              <span className="hidden sm:inline">Vider la corbeille</span>
            </Button>
          ) : undefined
        }
      >
        <ListDensityToggle />
      </ListToolbar>

      <p className="border-b bg-muted/40 px-5 py-2 text-xs text-muted-foreground">
        Les courriers supprimés restent ici {TRASH_RETENTION_DAYS} jours, avec leurs réponses et pièces jointes, puis
        sont supprimés définitivement.
      </p>

      {!organizationId ? (
        <ListMessage>Veuillez sélectionner une organisation.</ListMessage>
      ) : trash.isError ? (
        <ListMessage>Impossible de charger la corbeille.</ListMessage>
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          isLoading={trash.isLoading}
          getRowId={(r) => r.id}
          sortable={false}
          emptyMessage={
            query ? "Aucun courrier de la corbeille ne correspond à cette recherche." : "La corbeille est vide."
          }
        />
      )}

      <AlertDialog open={!!confirm} onOpenChange={(open) => !open && !busy && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.kind === "empty" ? "Vider la corbeille ?" : "Supprimer définitivement ce courrier ?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.kind === "empty"
                ? total > 1
                  ? `${total} courriers seront supprimés définitivement, avec leurs réponses et pièces jointes.`
                  : "1 courrier sera supprimé définitivement, avec ses réponses et pièces jointes."
                : `Le courrier${confirm?.row.subject ? ` « ${confirm.row.subject} »` : ""} sera supprimé définitivement, avec ses réponses et pièces jointes.`}{" "}
              Cette action est irréversible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Annuler</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                if (confirm?.kind === "empty") empty.mutate();
                else if (confirm?.kind === "purge") purge.mutate(confirm.row);
              }}
            >
              {purge.isPending || empty.isPending ? "Suppression…" : "Supprimer définitivement"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ListPage>
  );
}
