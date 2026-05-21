import { describe, it, expect, beforeEach, vi } from "vitest";
import "../mocks/supabase";
import { mockSupabase } from "../mocks/supabase";

const { logEvent } = await import("@/services/courierEventService");

const ORG_ID = "org-1";
const COURIER_ID = "courier-1";

beforeEach(() => {
  vi.clearAllMocks();
  mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
});

describe("courierEventService", () => {
  describe("logEvent", () => {
    it("insère un événement avec les bons champs", async () => {
      const insertMock = vi.fn().mockResolvedValue({ data: null, error: null });
      mockSupabase.from.mockReturnValue({ insert: insertMock });

      await logEvent(ORG_ID, COURIER_ID, "note_added", { preview: "Bonjour" });

      expect(insertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          organization_id: ORG_ID,
          courier_id: COURIER_ID,
          event_type: "note_added",
          payload: { preview: "Bonjour" },
          created_by: "user-1",
        })
      );
    });

    it("insère payload: null si aucun payload fourni", async () => {
      const insertMock = vi.fn().mockResolvedValue({ data: null, error: null });
      mockSupabase.from.mockReturnValue({ insert: insertMock });

      await logEvent(ORG_ID, COURIER_ID, "state_changed");

      expect(insertMock).toHaveBeenCalledWith(
        expect.objectContaining({ payload: null })
      );
    });

    it("ne lève jamais d'exception même si Supabase échoue (fire-and-forget)", async () => {
      mockSupabase.from.mockReturnValue({
        insert: vi.fn().mockRejectedValue(new Error("Network error")),
      });

      await expect(logEvent(ORG_ID, COURIER_ID, "note_added")).resolves.toBeUndefined();
    });

    it("ne lève pas d'exception si getUser échoue", async () => {
      mockSupabase.auth.getUser.mockRejectedValue(new Error("Auth error"));
      mockSupabase.from.mockReturnValue({
        insert: vi.fn().mockResolvedValue({ data: null, error: null }),
      });

      await expect(logEvent(ORG_ID, COURIER_ID, "note_added")).resolves.toBeUndefined();
    });

    it("utilise null comme created_by si aucun user connecté", async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null }, error: null });
      const insertMock = vi.fn().mockResolvedValue({ data: null, error: null });
      mockSupabase.from.mockReturnValue({ insert: insertMock });

      await logEvent(ORG_ID, COURIER_ID, "state_changed");

      expect(insertMock).toHaveBeenCalledWith(
        expect.objectContaining({ created_by: null })
      );
    });
  });
});
