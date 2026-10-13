import { afterEach, describe, expect, it, vi } from "vitest";

const createRelation = vi.fn(async () => ({ id: "rel-1" }));
const deleteRelation = vi.fn(async () => undefined);
const logEvent = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock("@/services/courierRelationService", () => ({ createRelation, deleteRelation }));
vi.mock("@/services/courierEventService", () => ({ logEvent }));

const { linkOutboundToInbound, unlinkOutboundFromInbound } = await import("@/services/outboundCourierService");

const OUT = { id: "s1", chrono: "2026-S-00007", subject: "Convocation" };
const IN = { id: "e1", chrono: "2026-E-00042", subject: "Nuisances rue X" };

afterEach(() => vi.clearAllMocks());

describe("liens d'un courrier à l'initiative", () => {
  it("un lien « sujet lié », jamais un parent, tracé des deux côtés", async () => {
    await linkOutboundToInbound({ organizationId: "org-1", outbound: OUT, inbound: IN, note: "Suite à sa plainte" });

    expect(createRelation).toHaveBeenCalledWith({
      organizationId: "org-1",
      sourceCourierId: "s1",
      targetCourierId: "e1",
      relationType: "sujet_lie",
      note: "Suite à sa plainte",
      createdVia: "manual",
    });
    expect(logEvent).toHaveBeenCalledWith("org-1", "s1", "outbound_linked", expect.objectContaining({ other_chrono: "2026-E-00042" }));
    expect(logEvent).toHaveBeenCalledWith("org-1", "e1", "outbound_linked", expect.objectContaining({ other_chrono: "2026-S-00007", reply_id: "s1" }));
  });

  it("le retrait aussi laisse une trace des deux côtés", async () => {
    await unlinkOutboundFromInbound({ organizationId: "org-1", relationId: "rel-1", outbound: OUT, inbound: IN });
    expect(deleteRelation).toHaveBeenCalledWith("rel-1");
    expect(logEvent).toHaveBeenCalledTimes(2);
    expect(logEvent.mock.calls.map((c) => [c[1], c[2]])).toEqual([
      ["s1", "outbound_unlinked"],
      ["e1", "outbound_unlinked"],
    ]);
  });
});
