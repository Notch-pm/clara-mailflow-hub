import { vi } from "vitest";

// Chainable query builder mock
function makeQueryBuilder(resolvedValue: unknown = { data: null, error: null }) {
  const builder: Record<string, unknown> = {};
  const chain = (returnValue?: unknown) => {
    const val = returnValue ?? builder;
    const methods = [
      "select", "insert", "update", "delete", "upsert",
      "eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike",
      "in", "is", "not", "or", "and", "order", "limit", "range",
      "single", "maybeSingle", "filter", "match",
    ];
    for (const m of methods) {
      (val as Record<string, unknown>)[m] = vi.fn(() => chain(val));
    }
    // Terminal: await resolves to resolvedValue
    (val as Record<string, unknown>).then = vi.fn((resolve: (v: unknown) => unknown) =>
      Promise.resolve(resolvedValue).then(resolve)
    );
    return val;
  };
  return chain();
}

export const mockSupabase = {
  from: vi.fn(() => makeQueryBuilder()),
  rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
  auth: {
    getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }),
    getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
    onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    signOut: vi.fn().mockResolvedValue({ error: null }),
    signInWithPassword: vi.fn().mockResolvedValue({ data: {}, error: null }),
    resetPasswordForEmail: vi.fn().mockResolvedValue({ data: {}, error: null }),
  },
  functions: {
    invoke: vi.fn().mockResolvedValue({ data: null, error: null }),
  },
  storage: {
    from: vi.fn(() => ({
      upload: vi.fn().mockResolvedValue({ data: null, error: null }),
      remove: vi.fn().mockResolvedValue({ data: null, error: null }),
      getPublicUrl: vi.fn(() => ({ data: { publicUrl: "https://example.com/avatar.png" } })),
    })),
  },
};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: mockSupabase,
  setOrganizationId: vi.fn(),
}));
