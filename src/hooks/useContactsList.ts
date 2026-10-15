import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { buildCsv, downloadCsv } from "@/components/data-table/csv-export";
import { CONTACT_CSV_COLUMNS } from "@/lib/contact-labels";
import type { ContactCategory } from "@/lib/contact-categories";
import {
  buildContactFilters,
  CONTACTS_PAGE_SIZE,
  describeActiveFilters,
  paginateContacts,
  type ContactFilterKey,
  type ContactStatusFilter,
} from "@/lib/contact-list";
import {
  fetchAllContactsForExport,
  listContacts,
  type SocleContactType,
} from "@/services/socleContactService";

/** État (filtres, pagination à l'aveugle), requête et export CSV de l'annuaire. */
export function useContactsList(organizationId: string | null | undefined) {
  const [search, setSearchState] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  const [typeFilter, setTypeFilterState] = useState<SocleContactType | "all">("all");
  const [statusFilter, setStatusFilterState] = useState<ContactStatusFilter>("active");
  const [categoryFilter, setCategoryFilterState] = useState<ContactCategory[]>([]);
  const [page, setPage] = useState(0);
  const [exporting, setExporting] = useState(false);

  const state = { search, typeFilter, statusFilter, categoryFilter };
  const filters = useMemo(
    () => buildContactFilters({ search: "", typeFilter, statusFilter, categoryFilter }, debouncedSearch),
    [debouncedSearch, typeFilter, statusFilter, categoryFilter],
  );

  const contactsQuery = useQuery({
    queryKey: ["socle-contacts", organizationId, filters, page],
    queryFn: () =>
      listContacts(organizationId!, { ...filters, limit: CONTACTS_PAGE_SIZE + 1, offset: page * CONTACTS_PAGE_SIZE }),
    enabled: !!organizationId,
    staleTime: 30_000,
  });

  const fetched = contactsQuery.data;
  // Stable d'un rendu à l'autre : le tableau ne recalcule ses lignes qu'à l'arrivée d'une page.
  const { rows: contacts, hasNextPage } = useMemo(() => paginateContacts(fetched), [fetched]);

  // Tout changement de filtre revient à la première page.
  const setSearch = (v: string) => { setSearchState(v); setPage(0); };
  const setTypeFilter = (v: SocleContactType | "all") => { setTypeFilterState(v); setPage(0); };
  const setStatusFilter = (v: ContactStatusFilter) => { setStatusFilterState(v); setPage(0); };
  const setCategoryFilter = (v: ContactCategory[]) => { setCategoryFilterState(v); setPage(0); };

  const removers: Record<ContactFilterKey, () => void> = {
    search: () => setSearch(""),
    type: () => setTypeFilter("all"),
    category: () => setCategoryFilter([]),
    status: () => setStatusFilter("active"),
  };
  const chips = describeActiveFilters(state).map((c) => ({ ...c, onRemove: removers[c.key] }));

  // Réinitialiser, c'est revenir à l'affichage par défaut : les contacts actifs.
  function resetFilters() {
    setSearchState("");
    setTypeFilterState("all");
    setStatusFilterState("active");
    setCategoryFilterState([]);
    setPage(0);
  }

  async function exportCsv() {
    if (!organizationId) return;
    setExporting(true);
    try {
      const rows = await fetchAllContactsForExport(organizationId, filters);
      downloadCsv(buildCsv(rows, CONTACT_CSV_COLUMNS), "contacts.csv");
      toast.success(`${rows.length} contact(s) exporté(s)`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur lors de l'export");
    } finally {
      setExporting(false);
    }
  }

  return {
    ...state,
    setSearch,
    setTypeFilter,
    setStatusFilter,
    setCategoryFilter,
    page,
    setPage,
    contacts,
    hasNextPage,
    contactsQuery,
    chips,
    resetFilters,
    exporting,
    exportCsv,
  };
}
