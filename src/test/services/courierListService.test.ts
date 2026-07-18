import { describe, it, expect, beforeEach, vi } from "vitest";
import "../mocks/supabase";
import { mockSupabase } from "../mocks/supabase";

const { fetchCourierListPage, fetchAllCouriersForExport, EXPORT_PAGE_SIZE } =
  await import("@/services/courierListService");

const ORG_ID = "org-1";

/** Filtres minimaux : visibleSocleOrganizationIds est obligatoire par conception. */
const baseFilters = {
  organizationId: ORG_ID,
  visibleSocleOrganizationIds: null,
} as const;

function row(id: string, totalCount: number) {
  return { id, total_count: totalCount, tags: [], is_transferred: false };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchCourierListPage", () => {
  it("traduit page/pageSize en limit et offset", async () => {
    mockSupabase.rpc = vi.fn().mockResolvedValue({ data: [row("a", 130)], error: null });

    await fetchCourierListPage({ ...baseFilters }, 2, 25);

    const params = mockSupabase.rpc.mock.calls[0][1];
    expect(params.p_limit).toBe(25);
    expect(params.p_offset).toBe(50);
  });

  it("déduit pageCount du total renvoyé par le RPC", async () => {
    mockSupabase.rpc = vi.fn().mockResolvedValue({ data: [row("a", 130)], error: null });

    const page = await fetchCourierListPage({ ...baseFilters }, 0, 25);

    expect(page.totalCount).toBe(130);
    expect(page.pageCount).toBe(6); // ceil(130 / 25)
  });

  it("renvoie un total nul et une page unique sur résultat vide", async () => {
    mockSupabase.rpc = vi.fn().mockResolvedValue({ data: [], error: null });

    const page = await fetchCourierListPage({ ...baseFilters }, 0, 25);

    expect(page.rows).toEqual([]);
    expect(page.totalCount).toBe(0);
    // pageCount plancher à 1 : une pagination à 0 page n'a pas de sens à l'écran.
    expect(page.pageCount).toBe(1);
  });

  it("transmet un tableau RBAC vide sans le convertir en null", async () => {
    // Distinction critique : null = admin (aucune restriction), [] = utilisateur
    // rattaché à aucun service, qui ne doit voir que les courriers non assignés.
    // Un `|| null` ici rouvrirait la fuite que le filtre serveur referme.
    mockSupabase.rpc = vi.fn().mockResolvedValue({ data: [], error: null });

    await fetchCourierListPage(
      { organizationId: ORG_ID, visibleSocleOrganizationIds: [] },
      0,
      25,
    );

    expect(mockSupabase.rpc.mock.calls[0][1].p_visible_socle_organization_ids).toEqual([]);
  });

  it("trie par date de réception décroissante en l'absence de consigne", async () => {
    // Le RPC a les mêmes valeurs par défaut, mais les poser ici rend le
    // comportement visible dans la requête plutôt que caché dans le SQL.
    mockSupabase.rpc = vi.fn().mockResolvedValue({ data: [], error: null });

    await fetchCourierListPage({ ...baseFilters }, 0, 25);

    const params = mockSupabase.rpc.mock.calls[0][1];
    expect(params.p_sort_by).toBe("received_at");
    expect(params.p_sort_dir).toBe("desc");
  });

  it("transmet la clé et le sens de tri choisis", async () => {
    mockSupabase.rpc = vi.fn().mockResolvedValue({ data: [], error: null });

    await fetchCourierListPage({ ...baseFilters, sortBy: "subject", sortDir: "asc" }, 0, 25);

    const params = mockSupabase.rpc.mock.calls[0][1];
    expect(params.p_sort_by).toBe("subject");
    expect(params.p_sort_dir).toBe("asc");
  });

  it("propage l'erreur du RPC", async () => {
    mockSupabase.rpc = vi.fn().mockResolvedValue({ data: null, error: new Error("DB error") });

    await expect(fetchCourierListPage({ ...baseFilters }, 0, 25)).rejects.toThrow("DB error");
  });
});

describe("fetchAllCouriersForExport", () => {
  it("s'arrête sur une page incomplète", async () => {
    mockSupabase.rpc = vi.fn().mockResolvedValue({ data: [row("a", 1)], error: null });

    const { rows, truncated } = await fetchAllCouriersForExport({ ...baseFilters });

    expect(rows).toHaveLength(1);
    expect(truncated).toBe(false);
    expect(mockSupabase.rpc).toHaveBeenCalledTimes(1);
  });

  it("enchaîne les pages tant qu'elles sont pleines", async () => {
    const full = Array.from({ length: EXPORT_PAGE_SIZE }, (_, i) => row(`r${i}`, 600));
    mockSupabase.rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: full, error: null })
      .mockResolvedValueOnce({ data: [row("last", 600)], error: null });

    const { rows, truncated } = await fetchAllCouriersForExport({ ...baseFilters });

    expect(rows).toHaveLength(EXPORT_PAGE_SIZE + 1);
    expect(truncated).toBe(false);
    expect(mockSupabase.rpc).toHaveBeenCalledTimes(2);
  });
});
