import { describe, it, expect, beforeEach, vi } from "vitest";
import "../mocks/supabase";
import { mockSupabase } from "../mocks/supabase";

const { listContacts, resolveCategoryRoleIds } = await import("@/services/socleContactService");

const ORG_ID = "org-1";

function lastInvokeBody(): Record<string, unknown> {
  const calls = mockSupabase.functions.invoke.mock.calls;
  return (calls[calls.length - 1][1] as { body: Record<string, unknown> }).body;
}

const elu = { id: "c-elu", roles: [{ id: "r1", name: "Élu", code: "elu" }] };
const habitant = { id: "c-hab", roles: [{ id: "r2", name: "Habitant", code: null }] };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listContacts — catégories Interne / Élus", () => {
  it("traduit `roles` en paramètre `role` du référentiel", async () => {
    mockSupabase.functions.invoke.mockResolvedValue({ data: [elu], error: null });

    await listContacts(ORG_ID, { roles: ["interne", "elu"], status: "active", limit: 50 });

    expect(lastInvokeBody()).toMatchObject({
      action: "list",
      filters: { role: "interne,elu", status: "active", limit: 50 },
    });
    expect((lastInvokeBody().filters as Record<string, unknown>).roles).toBeUndefined();
  });

  it("filtre aussi côté client : un référentiel antérieur à 1.3.0 ignore le paramètre", async () => {
    mockSupabase.functions.invoke.mockResolvedValue({ data: [elu, habitant], error: null });

    const result = await listContacts(ORG_ID, { roles: ["elu"] });

    expect(result.map((c) => c.id)).toEqual(["c-elu"]);
  });

  it("sans catégorie : ni paramètre, ni filtre", async () => {
    mockSupabase.functions.invoke.mockResolvedValue({ data: [elu, habitant], error: null });

    const result = await listContacts(ORG_ID, { search: "Du" });

    expect(lastInvokeBody().filters).toEqual({ search: "Du" });
    expect(result).toHaveLength(2);
  });
});

describe("resolveCategoryRoleIds", () => {
  it("lit le catalogue de rôles de l'organisation", async () => {
    mockSupabase.functions.invoke.mockResolvedValue({
      data: [
        { id: "r-elu", organization_id: ORG_ID, name: "Élu", code: "elu", created_at: null },
        { id: "r-int", organization_id: ORG_ID, name: "Interne", code: "interne", created_at: null },
        { id: "r-agent", organization_id: ORG_ID, name: "Agent", code: null, created_at: null },
      ],
      error: null,
    });

    expect(await resolveCategoryRoleIds(ORG_ID)).toEqual({ elu: "r-elu", interne: "r-int" });
    expect(lastInvokeBody()).toMatchObject({ action: "roles", organization_id: ORG_ID });
  });
});
