import { describe, it, expect, beforeEach, vi } from "vitest";
import "../mocks/supabase";
import { mockSupabase } from "../mocks/supabase";

const { createTicket, updateTicket } = await import("@/services/actionTicketService");

const ORG_ID = "org-1";
const COURIER_ID = "courier-1";
const TICKET_ID = "ticket-1";

/** Builder minimal : `select().eq().single()` résout, `update().eq()` est awaité. */
function builder(resolved: unknown) {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "insert", "update", "eq"]) {
    b[m] = vi.fn(() => b);
  }
  b.single = vi.fn().mockResolvedValue(resolved);
  b.then = vi.fn((resolve: (v: unknown) => unknown) => Promise.resolve(resolved).then(resolve));
  return b;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
  mockSupabase.functions.invoke.mockResolvedValue({ data: null, error: null });
});

describe("actionTicketService — notification d'affectation", () => {
  it("notifie à la création quand un destinataire est renseigné", async () => {
    mockSupabase.from.mockReturnValue(
      builder({ data: { id: TICKET_ID, assignee_id: "user-2" }, error: null }),
    );

    await createTicket({
      organizationId: ORG_ID,
      courierId: COURIER_ID,
      title: "Rappeler l'usager",
      assigneeId: "user-2",
    });

    expect(mockSupabase.functions.invoke).toHaveBeenCalledWith("send-assignment-notification", {
      body: { ticket_id: TICKET_ID },
    });
  });

  it("ne notifie pas à la création d'une action non affectée", async () => {
    mockSupabase.from.mockReturnValue(
      builder({ data: { id: TICKET_ID, assignee_id: null }, error: null }),
    );

    await createTicket({
      organizationId: ORG_ID,
      courierId: COURIER_ID,
      title: "Action sans destinataire",
      assigneeId: null,
    });

    expect(mockSupabase.functions.invoke).not.toHaveBeenCalled();
  });

  it("prévient les deux parties quand l'affectation change de titulaire", async () => {
    mockSupabase.from.mockReturnValue(builder({ data: { assignee_id: "user-2" }, error: null }));

    await updateTicket(TICKET_ID, { assigneeId: "user-3" });

    expect(mockSupabase.functions.invoke).toHaveBeenCalledWith("send-assignment-notification", {
      body: { ticket_id: TICKET_ID, unassigned_user_id: "user-2" },
    });
    expect(mockSupabase.functions.invoke).toHaveBeenCalledWith("send-assignment-notification", {
      body: { ticket_id: TICKET_ID },
    });
    expect(mockSupabase.functions.invoke).toHaveBeenCalledTimes(2);
  });

  it("ne renotifie pas le titulaire déjà affecté", async () => {
    mockSupabase.from.mockReturnValue(builder({ data: { assignee_id: "user-2" }, error: null }));

    await updateTicket(TICKET_ID, { assigneeId: "user-2", title: "Titre corrigé" });

    expect(mockSupabase.functions.invoke).not.toHaveBeenCalled();
  });

  it("ne notifie pas quand l'affectation n'est pas touchée", async () => {
    mockSupabase.from.mockReturnValue(builder({ data: { assignee_id: "user-2" }, error: null }));

    await updateTicket(TICKET_ID, { title: "Titre corrigé" });

    expect(mockSupabase.functions.invoke).not.toHaveBeenCalled();
  });

  it("prévient l'ancien titulaire quand l'affectation est retirée", async () => {
    mockSupabase.from.mockReturnValue(builder({ data: { assignee_id: "user-2" }, error: null }));

    await updateTicket(TICKET_ID, { assigneeId: null });

    expect(mockSupabase.functions.invoke).toHaveBeenCalledWith("send-assignment-notification", {
      body: { ticket_id: TICKET_ID, unassigned_user_id: "user-2" },
    });
    expect(mockSupabase.functions.invoke).toHaveBeenCalledTimes(1);
  });

  it("ne notifie rien si l'action n'était affectée à personne", async () => {
    mockSupabase.from.mockReturnValue(builder({ data: { assignee_id: null }, error: null }));

    await updateTicket(TICKET_ID, { assigneeId: null });

    expect(mockSupabase.functions.invoke).not.toHaveBeenCalled();
  });

  it("n'échoue pas si la notification tombe en erreur", async () => {
    mockSupabase.from.mockReturnValue(builder({ data: { assignee_id: null }, error: null }));
    mockSupabase.functions.invoke.mockRejectedValue(new Error("SMTP down"));

    await expect(updateTicket(TICKET_ID, { assigneeId: "user-3" })).resolves.toBeUndefined();
  });
});
