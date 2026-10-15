import type { ColumnDef } from "@tanstack/react-table";
import { ContactCategoryBadges } from "@/components/contacts/ContactCategoryBadge";
import { CONTACT_TYPE_ICONS } from "@/components/contacts/contact-type-icons";
import { ListCellText, ListCellTitle, StatusDot } from "@/components/list/ListCells";
import { phoneOrDash } from "@/lib/contact-labels";
import { SOCLE_CONTACT_TYPE_LABELS, type SocleContact } from "@/services/socleContactService";

/** Colonnes du tableau de l'annuaire. Le statut ne dit rien quand seuls les actifs sont affichés. */
export function buildContactColumns(showStatus: boolean): ColumnDef<SocleContact>[] {
  const cols: ColumnDef<SocleContact>[] = [
    {
      id: "type",
      accessorFn: (c) => SOCLE_CONTACT_TYPE_LABELS[c.contact_type],
      header: "Type",
      cell: ({ row }) => {
        const TypeIcon = CONTACT_TYPE_ICONS[row.original.contact_type];
        return (
          <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            <TypeIcon aria-hidden="true" className="h-4 w-4 shrink-0" />
            <span className="truncate">{SOCLE_CONTACT_TYPE_LABELS[row.original.contact_type]}</span>
          </span>
        );
      },
      meta: { label: "Type", width: 160 },
    },
    {
      id: "name",
      accessorFn: (c) => c.display_name ?? "",
      header: "Nom",
      cell: ({ row }) => <ListCellTitle title={row.original.display_name ?? "—"} />,
      enableHiding: false,
      meta: { label: "Nom", minWidth: 220 },
    },
    {
      id: "category",
      accessorFn: (c) => (c.roles ?? []).map((r) => r.name).join(", "),
      header: "Catégorie",
      cell: ({ row }) => <ContactCategoryBadges contact={row.original} />,
      meta: { label: "Catégorie", width: 140 },
    },
    {
      id: "email",
      accessorFn: (c) => c.email ?? "",
      header: "Email",
      cell: ({ row }) => <ListCellText>{row.original.email ?? "—"}</ListCellText>,
      meta: { label: "Email", width: 260 },
    },
    {
      id: "phone",
      accessorFn: (c) => phoneOrDash(c),
      header: "Téléphone",
      cell: ({ row }) => <ListCellText className="tabular-nums">{phoneOrDash(row.original)}</ListCellText>,
      meta: { label: "Téléphone", width: 150 },
    },
    {
      id: "city",
      accessorFn: (c) => c.city ?? "",
      header: "Ville",
      cell: ({ row }) => <ListCellText>{row.original.city ?? "—"}</ListCellText>,
      meta: { label: "Ville", width: 170 },
    },
  ];
  if (showStatus) {
    cols.push({
      id: "status",
      accessorFn: (c) => (c.status === "archived" ? "Archivé" : "Actif"),
      header: "Statut",
      cell: ({ row }) => (
        <StatusDot
          label={row.original.status === "archived" ? "Archivé" : "Actif"}
          tone={row.original.status === "archived" ? "muted" : "primary"}
        />
      ),
      meta: { label: "Statut", width: 110 },
    });
  }
  return cols;
}
