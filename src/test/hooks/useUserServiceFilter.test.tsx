import type { ReactNode } from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "../mocks/supabase";
import { mockSupabase } from "../mocks/supabase";

// P0 #1 du plan de tests QA — LE producteur du filtre RBAC intra-tenant :
//   null      → aucune restriction (admin / superadmin voit tout)
//   string[]  → l'utilisateur ne voit que ses organisations Socle (+ non-assignés)
//   []        → rattaché à AUCUNE organisation : ne voit que les non-assignés
// Une régression (ex. `?? null` au lieu de `?? []`) ferait fuir tous les
// courriers du tenant à un membre restreint, sans aucune alerte.

interface AuthState {
  profile: { is_superadmin?: boolean } | null;
  membership: { role?: string | null; organization_id?: string } | null;
  user: { id: string } | null;
}
let authState: AuthState;

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => authState,
}));

const { useUserServiceFilter, applyServiceFilter } = await import("@/hooks/useUserServiceFilter");

/** Builder minimal : from().select().eq() → thenable résolu avec `value`. */
function fromResolving(value: unknown) {
  const b: Record<string, unknown> = {};
  b.select = vi.fn(() => b);
  b.eq = vi.fn(() => b);
  (b as { then: unknown }).then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
    Promise.resolve(value).then(res, rej);
  return vi.fn(() => b);
}

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function render() {
  return renderHook(() => useUserServiceFilter(), { wrapper: makeWrapper() });
}

beforeEach(() => {
  vi.clearAllMocks();
  authState = {
    profile: { is_superadmin: false },
    membership: { role: "gestionnaire", organization_id: "org-tenant" },
    user: { id: "user-1" },
  };
});

describe("useUserServiceFilter — qui n'est PAS filtré", () => {
  it("superadmin → null, sans requête", () => {
    authState.profile = { is_superadmin: true };
    const { result } = render();
    expect(result.current).toBeNull();
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });

  it("administrateur d'org → null", () => {
    authState.membership = { role: "administrateur" };
    const { result } = render();
    expect(result.current).toBeNull();
  });

  it("rôle legacy 'admin' → null", () => {
    authState.membership = { role: "admin" };
    const { result } = render();
    expect(result.current).toBeNull();
  });
});

describe("useUserServiceFilter — membres restreints", () => {
  it("membre rattaché à 2 organisations → leurs UUIDs", async () => {
    mockSupabase.from = fromResolving({
      data: [{ socle_organization_id: "org-a" }, { socle_organization_id: "org-b" }],
      error: null,
    });
    const { result } = render();
    await waitFor(() => expect(result.current).toEqual(["org-a", "org-b"]));
  });

  it("membre rattaché à AUCUNE organisation → [] (jamais null)", async () => {
    mockSupabase.from = fromResolving({ data: [], error: null });
    const { result } = render();
    await waitFor(() => expect(mockSupabase.from).toHaveBeenCalled());
    expect(result.current).toEqual([]);
    expect(result.current).not.toBeNull();
  });

  it("pendant le chargement → [] par défaut, jamais null (pas de fenêtre de fuite)", () => {
    mockSupabase.from = fromResolving(new Promise(() => undefined)); // jamais résolue
    const { result } = render();
    expect(result.current).toEqual([]);
  });

  it("erreur de requête → reste [] (ne retombe JAMAIS sur null)", async () => {
    mockSupabase.from = fromResolving({ data: null, error: { message: "boom" } });
    const { result } = render();
    await waitFor(() => expect(mockSupabase.from).toHaveBeenCalled());
    expect(result.current).toEqual([]);
  });

  it("consultant → filtré comme les autres membres", async () => {
    authState.membership = { role: "consultant" };
    mockSupabase.from = fromResolving({ data: [{ socle_organization_id: "org-a" }], error: null });
    const { result } = render();
    await waitFor(() => expect(result.current).toEqual(["org-a"]));
  });
});

describe("applyServiceFilter", () => {
  const couriers = [
    { id: "1", socle_organization_id: "org-a" },
    { id: "2", socle_organization_id: "org-b" },
    { id: "3", socle_organization_id: null },
    { id: "4" }, // sans champ = non assigné
  ];

  it("filtre null (admin) → tout est visible", () => {
    expect(applyServiceFilter(couriers, null)).toHaveLength(4);
  });

  it("filtre [] (aucune organisation) → seuls les non-assignés restent", () => {
    expect(applyServiceFilter(couriers, []).map((c) => c.id)).toEqual(["3", "4"]);
  });

  it("filtre [org-a] → org-a + non-assignés", () => {
    expect(applyServiceFilter(couriers, ["org-a"]).map((c) => c.id)).toEqual(["1", "3", "4"]);
  });
});
