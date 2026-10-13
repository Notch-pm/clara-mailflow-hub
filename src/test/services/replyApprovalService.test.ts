import { afterEach, describe, expect, it, vi } from "vitest";
import { mockSupabase } from "../mocks/supabase";

/**
 * Le contexte d'approbation (parapheur en lot) d'un sortant. Un courrier à
 * l'initiative de la collectivité n'a pas de parent : il se vise et se signe
 * comme une réponse, seul l'ancrage de son historique change.
 */

vi.mock("@/services/socleOrgConfigService", () => ({
  listOrgsWithConfig: vi.fn(async () => [{ id: "so-1", name: "Cabinet", reply_workflow_id: "wf-r" }]),
}));
vi.mock("@/services/courierReplyService", () => ({
  getReplyWorkflow: vi.fn(async () => ({
    workflowId: "wf-r",
    states: [
      { id: "st-sig", name: "Signature", category: "processing", requires_signature: true },
      { id: "st-send", name: "Envoi", category: "processing" },
    ],
    transitions: [{ id: "t1", from_state_id: "st-sig", to_state_id: "st-send", kind: "next" }],
    initialState: null,
  })),
  signReply: vi.fn(),
  transitionReplyState: vi.fn(),
}));

const { loadApprovalContext } = await import("@/services/replyApprovalService");

function stubCourier(row: Record<string, unknown> | null) {
  mockSupabase.from.mockImplementation(() => {
    const builder: Record<string, unknown> = {};
    for (const m of ["select", "eq"]) builder[m] = vi.fn(() => builder);
    builder.maybeSingle = vi.fn(() => Promise.resolve({ data: row, error: null }));
    return builder;
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("loadApprovalContext", () => {
  it("une réponse : l'historique s'écrit sur le courrier reçu", async () => {
    stubCourier({
      id: "r1",
      parent_courier_id: "p1",
      workflow_state_id: "st-sig",
      metadata: { body_html: "<p>Bonjour</p>" },
      assigned_service: null,
      socle_organization_id: "so-1",
    });

    const ctx = await loadApprovalContext("org-1", "r1");

    expect(ctx.ref).toEqual({ organizationId: "org-1", eventCourierId: "p1", replyId: "r1" });
    expect(ctx.next?.id).toBe("st-send");
  });

  it("un sortant sans parent : plus d'exception, l'historique s'écrit sur lui-même", async () => {
    stubCourier({
      id: "s1",
      parent_courier_id: null,
      workflow_state_id: "st-sig",
      metadata: { body_html: "<p>Convocation</p>" },
      assigned_service: null,
      socle_organization_id: "so-1",
    });

    const ctx = await loadApprovalContext("org-1", "s1");

    expect(ctx.ref).toEqual({ organizationId: "org-1", eventCourierId: "s1", replyId: "s1" });
    expect(ctx.state?.id).toBe("st-sig");
    expect(ctx.bodyHtml).toBe("<p>Convocation</p>");
  });

  it("un courrier introuvable reste une erreur", async () => {
    stubCourier(null);
    await expect(loadApprovalContext("org-1", "absent")).rejects.toThrow("Courrier introuvable.");
  });
});
