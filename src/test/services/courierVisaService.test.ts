import { describe, it, expect, beforeEach, vi } from "vitest";
import "../mocks/supabase";
import { mockSupabase } from "../mocks/supabase";
import { describeCourierEvent } from "@/lib/courier-history";

const { activeVisaFor, grantVisa, listMyVisaQueue, listOrgViseurs, visaPersonName } =
  await import("@/services/courierVisaService");

const ORG_ID = "org-1";

// Constructeur de requête chaînable dont l'`await` rend `result` ; les appels
// sont consignés pour vérifier filtres et charges utiles.
function builder(result: unknown) {
  const calls: { method: string; args: unknown[] }[] = [];
  const b: Record<string, unknown> = { calls };
  for (const m of ["select", "insert", "eq", "in", "is", "order", "single", "maybeSingle"]) {
    b[m] = vi.fn((...args: unknown[]) => {
      calls.push({ method: m, args });
      return b;
    });
  }
  b.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return b as Record<string, ReturnType<typeof vi.fn>> & { calls: typeof calls };
}

function routeTables(byTable: Record<string, unknown[]>) {
  const built: Record<string, ReturnType<typeof builder>[]> = {};
  mockSupabase.from.mockImplementation((table: string) => {
    const queue = byTable[table];
    if (!queue || queue.length === 0) throw new Error(`table inattendue : ${table}`);
    const b = builder(queue.shift());
    (built[table] ??= []).push(b);
    return b;
  });
  return built;
}

function visa(overrides: Record<string, unknown> = {}) {
  return {
    id: "v-1",
    organization_id: ORG_ID,
    courier_id: "r-1",
    workflow_state_id: "s-visa",
    state_name: "Visa DGS",
    user_id: "u-1",
    designated_user_id: null,
    comment: null,
    visa_at: "2026-10-01T10:00:00Z",
    superseded_at: null,
    user: { id: "u-1", first_name: "Anne", last_name: "Viseur", email: "anne@x.fr" },
    designated: null,
    ...overrides,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("courierVisaService", () => {
  describe("activeVisaFor", () => {
    it("ignore un visa périmé et celui d'une autre étape", () => {
      const visas = [
        visa({ id: "old", superseded_at: "2026-10-01T11:00:00Z" }),
        visa({ id: "other", workflow_state_id: "s-autre" }),
      ];
      expect(activeVisaFor(visas, "r-1", "s-visa")).toBeNull();
      expect(activeVisaFor([...visas, visa({ id: "new" })], "r-1", "s-visa")).toMatchObject({ id: "new" });
    });
  });

  describe("visaPersonName", () => {
    it("retombe sur l'adresse puis sur un tiret", () => {
      expect(visaPersonName({ id: "u", first_name: "Anne", last_name: "Viseur", email: null })).toBe("Anne Viseur");
      expect(visaPersonName({ id: "u", first_name: null, last_name: null, email: "a@x.fr" })).toBe("a@x.fr");
      expect(visaPersonName(null)).toBe("—");
    });
  });

  describe("grantVisa", () => {
    it("insère le visa de l'étape courante et le journalise sur le courrier parent, avec le désigné remplacé", async () => {
      const built = routeTables({
        courier_visas: [{
          data: visa({
            comment: "Vu",
            designated_user_id: "u-2",
            designated: { id: "u-2", first_name: "Paul", last_name: "Désigné", email: null },
          }),
          error: null,
        }],
        courier_events: [{ data: null, error: null }],
      });

      await grantVisa({ organizationId: ORG_ID, parentCourierId: "c-1", replyId: "r-1", stateId: "s-visa", comment: "  Vu  " });

      const insert = built.courier_visas[0].insert;
      expect(insert).toHaveBeenCalledWith({
        organization_id: ORG_ID,
        courier_id: "r-1",
        workflow_state_id: "s-visa",
        comment: "Vu",
      });
      const event = built.courier_events[0].insert.mock.calls[0][0] as Record<string, unknown>;
      expect(event).toMatchObject({ courier_id: "c-1", event_type: "reply_visa_granted" });
      expect(event.payload).toMatchObject({ reply_id: "r-1", state_name: "Visa DGS", designated_name: "Paul Désigné", comment: "Vu" });
    });

    it("propage le refus du serveur (non-viseur)", async () => {
      routeTables({ courier_visas: [{ data: null, error: new Error("Visa interdit") }] });
      await expect(
        grantVisa({ organizationId: ORG_ID, parentCourierId: "c-1", replyId: "r-1", stateId: "s-visa" }),
      ).rejects.toThrow("Visa interdit");
    });
  });

  describe("listOrgViseurs", () => {
    it("ne garde que les rattachés portant l'attribut viseur et actifs", async () => {
      routeTables({
        socle_organization_viseurs: [{
          data: [
            { user_id: "u-1", users: { id: "u-1", first_name: "Zoé", last_name: "B", email: null } },
            { user_id: "u-2", users: { id: "u-2", first_name: "Alain", last_name: "A", email: null } },
            { user_id: "u-3", users: { id: "u-3", first_name: "Retiré", last_name: "C", email: null } },
          ],
          error: null,
        }],
        organization_users: [{
          data: [
            { user_id: "u-1", is_active: true },
            { user_id: "u-2", is_active: null },
            { user_id: "u-4", is_active: true },
          ],
          error: null,
        }],
      });
      const result = await listOrgViseurs(ORG_ID, "so-1");
      expect(result.map((p) => p.id)).toEqual(["u-2", "u-1"]);
    });
  });

  describe("listMyVisaQueue", () => {
    it("liste les réponses sans visa en vigueur de mes organisations, les miennes d'abord", async () => {
      routeTables({
        organization_users: [{ data: { is_viseur: true }, error: null }],
        socle_organization_viseurs: [{ data: [{ socle_organization_id: "so-1" }], error: null }],
        workflow_states: [{ data: [{ id: "s-visa", name: "Visa DGS" }], error: null }],
        couriers: [{
          data: [
            { id: "r-1", parent_courier_id: "c-1", chrono: null, subject: "A", workflow_state_id: "s-visa", metadata: {} },
            { id: "r-2", parent_courier_id: "c-2", chrono: null, subject: "B", workflow_state_id: "s-visa", metadata: { visa_viseurs: { "s-visa": "me" } } },
            { id: "r-3", parent_courier_id: "c-3", chrono: null, subject: "C", workflow_state_id: "s-visa", metadata: {} },
          ],
          error: null,
        }],
        courier_visas: [{ data: [visa({ courier_id: "r-3" })], error: null }],
      });

      const queue = await listMyVisaQueue(ORG_ID, "me");
      expect(queue.map((q) => q.id)).toEqual(["r-2", "r-1"]);
      expect(queue[0]).toMatchObject({ designated_to_me: true, state_name: "Visa DGS" });
    });

    it("rend une file vide si l'utilisateur n'est pas viseur", async () => {
      routeTables({
        organization_users: [{ data: { is_viseur: false }, error: null }],
        socle_organization_viseurs: [{ data: [{ socle_organization_id: "so-1" }], error: null }],
      });
      expect(await listMyVisaQueue(ORG_ID, "me")).toEqual([]);
    });
  });
});

describe("describeCourierEvent — reply_visa_granted", () => {
  it("dit l'étape, le désigné remplacé et le commentaire", () => {
    expect(
      describeCourierEvent("reply_visa_granted", { state_name: "Visa DGS", designated_name: "Paul D", comment: "OK" }),
    ).toEqual({ title: "Réponse visée", detail: "Étape « Visa DGS » · à la place de Paul D · « OK »" });
    expect(describeCourierEvent("reply_visa_granted", {})).toEqual({ title: "Réponse visée", detail: null });
  });
});
