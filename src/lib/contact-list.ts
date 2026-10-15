import { SOCLE_CONTACT_TYPE_LABELS, type SocleContactType } from "@/services/socleContactService";
import { CONTACT_CATEGORY_PLURAL_LABELS, type ContactCategory } from "@/lib/contact-categories";

export const CONTACTS_PAGE_SIZE = 100;

export type ContactStatusFilter = "active" | "archived" | "all";

export interface ContactListState {
  search: string;
  typeFilter: SocleContactType | "all";
  statusFilter: ContactStatusFilter;
  categoryFilter: ContactCategory[];
}

export function buildContactFilters(s: ContactListState, debouncedSearch: string) {
  return {
    search: debouncedSearch || undefined,
    type: s.typeFilter === "all" ? undefined : s.typeFilter,
    status: s.statusFilter === "all" ? undefined : s.statusFilter,
    roles: s.categoryFilter.length > 0 ? s.categoryFilter : undefined,
  };
}

/**
 * On demande PAGE_SIZE + 1 pour savoir s'il existe une page suivante, sans
 * afficher la ligne excédentaire. Comparer `length === PAGE_SIZE` laissait
 * « Suivant » actif quand la dernière page était exactement pleine. L'API du
 * Socle ne renvoie pas de total, d'où cette astuce.
 */
export function paginateContacts<T>(fetched: readonly T[] | undefined): { rows: T[]; hasNextPage: boolean } {
  const all = fetched ?? [];
  return { rows: all.slice(0, CONTACTS_PAGE_SIZE), hasNextPage: all.length > CONTACTS_PAGE_SIZE };
}

export type ContactFilterKey = "search" | "type" | "category" | "status";

/**
 * Pastilles des filtres actifs. La recherche vit dans le panneau « Filtres » :
 * sa pastille dit, panneau fermé, pourquoi la liste est réduite.
 */
export function describeActiveFilters(s: ContactListState): { key: ContactFilterKey; label: string }[] {
  const search = s.search.trim();
  const out: { key: ContactFilterKey; label: string }[] = [];
  if (search) out.push({ key: "search", label: `Recherche : « ${search} »` });
  if (s.typeFilter !== "all") out.push({ key: "type", label: `Type : ${SOCLE_CONTACT_TYPE_LABELS[s.typeFilter]}` });
  if (s.categoryFilter.length > 0) {
    out.push({
      key: "category",
      label: `Catégorie : ${s.categoryFilter.map((c) => CONTACT_CATEGORY_PLURAL_LABELS[c].toLowerCase()).join(", ")}`,
    });
  }
  if (s.statusFilter !== "active") {
    out.push({ key: "status", label: s.statusFilter === "archived" ? "Statut : archivés" : "Archivés inclus" });
  }
  return out;
}

export function pageSummary(page: number, shown: number, isFetching: boolean): string {
  if (isFetching) return "Chargement…";
  if (!shown) return `Page ${page + 1}`;
  const first = page * CONTACTS_PAGE_SIZE + 1;
  return `Contacts ${first.toLocaleString("fr-FR")}–${(first + shown - 1).toLocaleString("fr-FR")} · page ${page + 1}`;
}
