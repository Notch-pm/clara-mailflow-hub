import type { ColumnDef } from "@tanstack/react-table";
import { FileText, Globe, Headset, Mail, Landmark, MoreHorizontal, Store } from "lucide-react";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { ListCellDate, ListCellText, ListCellTitle, StatusDot, type StatusTone } from "@/components/list/ListCells";
import { readableTextColor } from "@/lib/tag-color";
import type { CourierListRow } from "@/services/courierListService";
import type { CourierChannel } from "@/types/courier";
import { SlaStatusDot } from "@/components/courier/SlaStatus";
import {
  SLA_AXIS_LABELS,
  parisDay,
  primarySla,
  slaLabel,
  type CourierSla,
  type SlaKind,
} from "@/lib/courier-sla";

/*
 * Colonnes partagées des listes de courriers (instruction, traités, archivés,
 * sortants). Chaque liste compose les siennes ; les largeurs sont fixes (cf.
 * `DataTable`), l'objet prend la place restante.
 *
 * Tri : l'`id` d'une colonne triable EST la clé serveur (`COURIER_SORT_KEYS`) —
 * le renommer casse le tri. Restent `enableSorting: false` les colonnes que le
 * RPC ne sait pas trier sans payer le prix que la pagination économise :
 * expéditeur et destinataire viennent de jointures appliquées après le
 * découpage, l'état demanderait une jointure de plus, les tags sont un tableau
 * jsonb, le canal une énumération dont l'ordre n'est pas celui des libellés.
 */

type CourierColumn = ColumnDef<CourierListRow>;

export const CHANNEL_LABELS: Record<CourierChannel, string> = {
  paper: "Papier",
  email: "Email",
  portal: "Portail",
  relaye_elu: "Relayé élu",
  relaye_agent: "Relayé agent",
  guichet: "Guichet",
  autre: "Autre",
};

const CHANNEL_ICONS: Record<CourierChannel, typeof Mail> = {
  paper: FileText,
  email: Mail,
  portal: Globe,
  relaye_elu: Landmark,
  relaye_agent: Headset,
  guichet: Store,
  autre: MoreHorizontal,
};

export function courierSenderName(c: CourierListRow): string {
  return c.sender_name ?? [c.sender_last_name, c.sender_first_name].filter(Boolean).join(" ");
}

function shortDate(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("fr-FR");
}

const MONTH_FORMAT = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" });

/** « Septembre 2026 » — valeur de groupement des colonnes de date. */
function monthOf(value: string | null | undefined): string {
  if (!value) return "Sans date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sans date";
  const month = MONTH_FORMAT.format(date);
  return month.charAt(0).toUpperCase() + month.slice(1);
}

/**
 * Objet sur deux niveaux : l'objet, puis le correspondant (expéditeur d'un
 * courrier reçu, destinataire d'un courrier envoyé). Le correspondant n'a plus
 * de colonne à lui, mais reste exporté (`exportExtra`).
 */
export function subjectColumn(correspondent: "sender" | "recipient"): CourierColumn {
  const exportLabel = correspondent === "sender" ? "Expéditeur" : "Destinataire";
  const who = (c: CourierListRow) =>
    (correspondent === "sender" ? courierSenderName(c) : c.recipient_name) || "";
  return {
    accessorKey: "subject",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Objet" />,
    cell: ({ row }) => (
      <ListCellTitle title={row.original.subject || "Sans objet"} meta={who(row.original) || undefined} />
    ),
    // Colonne principale : c'est elle qui absorbe la largeur, on ne la masque pas.
    enableHiding: false,
    enableGrouping: false,
    meta: { exportLabel: "Objet", minWidth: 240, exportExtra: [{ header: exportLabel, accessor: who }] },
  };
}

export function chronoColumn(): CourierColumn {
  return {
    accessorKey: "chrono",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Chrono" />,
    cell: ({ row }) => (
      <span className="block truncate font-mono text-xs tabular-nums text-muted-foreground">
        {row.original.chrono ?? "—"}
      </span>
    ),
    enableGrouping: false,
    meta: { exportLabel: "Chrono", width: 112 },
  };
}

/**
 * État dans le workflow. Toutes les lignes d'une liste partagent la même
 * catégorie : la teinte de la pastille dit donc la liste (en cours, traité,
 * archivé), le libellé dit l'état.
 */
export function stateColumn(stateById: Map<string, { name: string }>, tone: StatusTone): CourierColumn {
  return {
    id: "state",
    accessorFn: (c) => stateById.get(c.workflow_state_id ?? "")?.name ?? "",
    enableSorting: false,
    header: "État",
    cell: ({ row }) => {
      const name = stateById.get(row.original.workflow_state_id ?? "")?.name;
      return name ? <StatusDot label={name} tone={tone} /> : null;
    },
    meta: { exportLabel: "État", width: 160 },
  };
}

export function organisationColumn(): CourierColumn {
  return {
    accessorKey: "assigned_service",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Organisation" />,
    cell: ({ row }) => <ListCellText>{row.original.assigned_service ?? "—"}</ListCellText>,
    meta: { exportLabel: "Organisation", width: 160 },
  };
}

export function recipientColumn(): CourierColumn {
  return {
    id: "recipient",
    accessorFn: (c) => c.recipient_name ?? "—",
    enableSorting: false,
    header: "Destinataire",
    cell: ({ row }) => <ListCellText>{row.original.recipient_name ?? "—"}</ListCellText>,
    meta: { exportLabel: "Destinataire", width: 140 },
  };
}

export function channelColumn(): CourierColumn {
  return {
    id: "channel",
    accessorFn: (c) => (c.channel ? CHANNEL_LABELS[c.channel] ?? c.channel : ""),
    enableSorting: false,
    header: "Canal",
    cell: ({ row }) => {
      const channel = row.original.channel;
      if (!channel) return null;
      const Icon = CHANNEL_ICONS[channel] ?? Mail;
      return (
        <span className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 text-[11.5px] font-semibold text-muted-foreground">
          <Icon aria-hidden="true" className="h-3 w-3 shrink-0" />
          <span className="truncate">{CHANNEL_LABELS[channel] ?? channel}</span>
        </span>
      );
    },
    meta: { exportLabel: "Canal", width: 120 },
  };
}

/** Deux tags au plus sur la ligne, le reste en « +N » : la hauteur de ligne ne bouge pas. */
export function tagsColumn(tagByName: Map<string, { color: string | null }>): CourierColumn {
  return {
    id: "tags",
    accessorFn: (c) => c.tags.join(", "),
    enableSorting: false,
    enableGrouping: false,
    header: "Tags",
    cell: ({ row }) => {
      const tags = row.original.tags;
      if (!tags.length) return null;
      const rest = tags.slice(2);
      return (
        <div className="flex min-w-0 items-center gap-1">
          {tags.slice(0, 2).map((t) => {
            const color = tagByName.get(t.toLowerCase())?.color ?? null;
            return (
              <span
                key={t}
                className="inline-block min-w-0 max-w-[100px] truncate rounded-full bg-muted px-2 py-0.5 text-[10.5px] font-semibold text-muted-foreground"
                // Couleur choisie par l'organisation pour ce tag : une donnée, pas un style.
                style={color ? { backgroundColor: color, color: readableTextColor(color) } : undefined}
              >
                {t}
              </span>
            );
          })}
          {rest.length > 0 && (
            <span className="shrink-0 text-[11px] font-semibold text-muted-foreground" title={rest.join(", ")}>
              +{rest.length}
            </span>
          )}
        </div>
      );
    },
    meta: { exportLabel: "Tags", width: 150 },
  };
}

interface DateColumnOptions {
  /** Clé serveur si la colonne est triable (`received_at`, `sent_at`), identifiant libre sinon. */
  id: string;
  title: string;
  exportLabel: string;
  groupLabel: string;
  value: (c: CourierListRow) => string | null | undefined;
  sortable?: boolean;
}

/**
 * Date alignée à droite, chiffres tabulaires. Groupée, elle regroupe par mois
 * — par jour, chaque groupe ne compterait que quelques lignes.
 */
export function dateColumn({
  id,
  title,
  exportLabel,
  groupLabel,
  value,
  sortable = false,
}: DateColumnOptions): CourierColumn {
  return {
    id,
    accessorFn: (c) => shortDate(value(c)),
    getGroupingValue: (c) => monthOf(value(c)),
    enableSorting: sortable,
    // Premier clic : les plus récents d'abord ; l'inverse se lit comme un bug.
    sortDescFirst: true,
    header: sortable
      ? ({ column }) => <DataTableColumnHeader column={column} title={title} className="-mr-1.5 ml-0" />
      : title,
    cell: ({ row }) => <ListCellDate value={value(row.original)} />,
    meta: { label: title, exportLabel, groupLabel, width: 108, align: "right" },
  };
}

/**
 * Échéance du courrier (délais de traitement) : l'accusé de réception tant qu'il
 * reste à faire, puis la résolution. Groupée, elle range par statut — « En
 * retard » d'abord, c'est la question qu'on pose à la liste.
 */
export function slaColumn(
  slaOf: (c: CourierListRow) => CourierSla | null,
): CourierColumn {
  const primary = (c: CourierListRow) => {
    const sla = slaOf(c);
    return sla ? primarySla(sla) : null;
  };
  const today = parisDay(new Date())!;
  return {
    id: "sla",
    accessorFn: (c) => {
      const p = primary(c);
      return p ? `${SLA_AXIS_LABELS[p.axis]} : ${slaLabel(p.status, today)}` : "";
    },
    getGroupingValue: (c) => SLA_GROUP_LABELS[primary(c)?.status.kind ?? "none"],
    enableSorting: false,
    header: "Échéance",
    cell: ({ row }) => {
      const p = primary(row.original);
      if (!p) return <ListCellText>—</ListCellText>;
      return (
        <span title={SLA_AXIS_LABELS[p.axis]} className="block min-w-0">
          <SlaStatusDot status={p.status} prefix={p.axis === "ack" ? "AR" : undefined} />
        </span>
      );
    },
    meta: { exportLabel: "Échéance", groupLabel: "Échéance", width: 220 },
  };
}

const SLA_GROUP_LABELS: Record<SlaKind, string> = {
  overdue: "En retard",
  due_soon: "Échéance proche",
  pending: "Dans les temps",
  met: "Tenu",
  missed: "Hors délai",
  none: "Sans objectif",
};
