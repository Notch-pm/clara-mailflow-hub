import { SOCLE_CONTACT_TYPE_LABELS, type SocleContact } from "@/services/socleContactService";
import type { CsvColumn } from "@/components/data-table/csv-export";

/** Libellés et formats d'affichage de l'annuaire des contacts (fiche, liste, export). */

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("fr-FR");
}

/** Colonne « Téléphone » de la liste : mobile, sinon fixe, sinon tiret. */
export function phoneOrDash(c: Pick<SocleContact, "mobile_phone" | "landline_phone">): string {
  return c.mobile_phone || c.landline_phone || "—";
}

export function civilityLabel(value: string | null | undefined): string | null {
  return value === "madame" ? "Madame" : value === "monsieur" ? "Monsieur" : null;
}

export function channelLabel(value: string | null | undefined): string | null {
  return value === "email" ? "Email" : value === "telephone" ? "Téléphone" : value === "courrier" ? "Courrier" : null;
}

export function contactAddress(c: Pick<SocleContact, "address_line1" | "address_line2">): string {
  return [c.address_line1, c.address_line2].filter(Boolean).join(", ");
}

export const CONTACT_CSV_COLUMNS: CsvColumn<SocleContact>[] = [
  { header: "Type", accessor: (c) => SOCLE_CONTACT_TYPE_LABELS[c.contact_type] },
  { header: "Nom", accessor: (c) => c.display_name ?? "" },
  { header: "Email", accessor: (c) => c.email ?? "" },
  { header: "Téléphone mobile", accessor: (c) => c.mobile_phone ?? "" },
  { header: "Téléphone fixe", accessor: (c) => c.landline_phone ?? "" },
  { header: "Adresse", accessor: (c) => contactAddress(c) },
  { header: "Code postal", accessor: (c) => c.postal_code ?? "" },
  { header: "Ville", accessor: (c) => c.city ?? "" },
  { header: "Quartier", accessor: (c) => c.quartier?.name ?? "" },
  { header: "Rôles", accessor: (c) => (c.roles ?? []).map((r) => r.name).join(", ") },
  { header: "SIRET", accessor: (c) => c.siret ?? "" },
  { header: "Statut", accessor: (c) => (c.status === "active" ? "Actif" : "Archivé") },
];
