import type { ReactNode } from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "../mocks/supabase";
import { mockSupabase } from "../mocks/supabase";

const { useCourierList } = await import("@/hooks/useCourierList");
const { COURIER_SORT_KEYS } = await import("@/services/courierListService");
type CourierSort = import("@/hooks/useCourierList").CourierSort;

/** Filtres minimaux : visibleSocleOrganizationIds est obligatoire par conception. */
const FILTERS = {
  organizationId: "org-1",
  visibleSocleOrganizationIds: null,
} as const;

const DEFAULT_SORT: CourierSort = { key: "updated_at", dir: "desc" };

/** 500 résultats : de quoi tenir 20 pages, sinon l'effet de recalage ramène en
 *  page 0 et masquerait ce que les tests de tri cherchent à observer. */
function page(total = 500) {
  return { data: [{ id: "a", total_count: total, tags: [], is_transferred: false }], error: null };
}

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function render(defaultSort: CourierSort = DEFAULT_SORT) {
  return renderHook(
    () => useCourierList(FILTERS, { queryKeyPrefix: "test-couriers", defaultSort }),
    { wrapper: makeWrapper() },
  );
}

/** Paramètres du dernier appel au RPC. */
function lastRpcParams() {
  const calls = mockSupabase.rpc.mock.calls;
  return calls[calls.length - 1][1];
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSupabase.rpc = vi.fn().mockResolvedValue(page());
});

describe("useCourierList — tri serveur", () => {
  it("envoie le tri par défaut au RPC", async () => {
    render();

    await waitFor(() => expect(mockSupabase.rpc).toHaveBeenCalled());
    expect(lastRpcParams().p_sort_by).toBe("updated_at");
    expect(lastRpcParams().p_sort_dir).toBe("desc");
  });

  it("renvoie une nouvelle requête quand l'utilisateur change de colonne", async () => {
    const { result } = render();
    await waitFor(() => expect(mockSupabase.rpc).toHaveBeenCalled());

    act(() => result.current.onSortingChange([{ id: "subject", desc: false }]));

    await waitFor(() => expect(lastRpcParams().p_sort_by).toBe("subject"));
    expect(lastRpcParams().p_sort_dir).toBe("asc");
  });

  it("revient en première page quand le tri change", async () => {
    // L'invariant qui casse en silence : rester en page 4 après un changement
    // de tri affiche un segment arbitraire du nouvel ordre, sans que rien ne
    // signale l'incohérence.
    const { result } = render();
    await waitFor(() => expect(mockSupabase.rpc).toHaveBeenCalled());

    act(() => result.current.setPage(3));
    await waitFor(() => expect(result.current.page).toBe(3));

    act(() => result.current.onSortingChange([{ id: "subject", desc: false }]));

    await waitFor(() => expect(result.current.page).toBe(0));
    expect(lastRpcParams().p_offset).toBe(0);
  });

  it("ignore une colonne que le serveur ne sait pas trier", async () => {
    // « sender » vient d'une jointure appliquée après le découpage : le RPC
    // retomberait silencieusement sur received_at. Mieux vaut ne rien changer
    // et le signaler au développeur.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { result } = render();
    await waitFor(() => expect(mockSupabase.rpc).toHaveBeenCalled());

    act(() => result.current.onSortingChange([{ id: "sender", desc: false }]));

    expect(result.current.sorting).toEqual([{ id: "updated_at", desc: true }]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("conserve le tri courant si la table le retire", async () => {
    // enableSortingRemoval: false l'empêche côté DataTable ; le hook ne s'y fie
    // pas — sans ORDER BY explicite, deux pages successives peuvent se recouvrir.
    const { result } = render();
    await waitFor(() => expect(mockSupabase.rpc).toHaveBeenCalled());

    act(() => result.current.onSortingChange([]));

    expect(result.current.sorting).toEqual([{ id: "updated_at", desc: true }]);
  });

  it("expose des filtres portant le tri, pour que l'export CSV suive l'écran", async () => {
    const { result } = render();
    await waitFor(() => expect(mockSupabase.rpc).toHaveBeenCalled());

    act(() => result.current.onSortingChange([{ id: "chrono", desc: false }]));

    expect(result.current.filters).toMatchObject({ sortBy: "chrono", sortDir: "asc" });
  });

  it("n'accepte que des clés que le RPC sait trier", () => {
    // Garde-fou de cohérence : les pages utilisent l'`id` de colonne comme clé
    // serveur, et le SQL retombe sur received_at pour toute valeur inconnue.
    expect(COURIER_SORT_KEYS).toContain("subject");
    expect(COURIER_SORT_KEYS).not.toContain("sender");
    expect(COURIER_SORT_KEYS).not.toContain("state");
  });
});
