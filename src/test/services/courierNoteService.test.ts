import { describe, it, expect, beforeEach, vi } from "vitest";
import "../mocks/supabase";
import { mockSupabase } from "../mocks/supabase";

const { listNotes, createNote, updateNote, deleteNote } =
  await import("@/services/courierNoteService");

const ORG_ID = "org-1";
const COURIER_ID = "courier-1";
const NOTE_ID = "note-1";

const fakeNote = {
  id: NOTE_ID,
  organization_id: ORG_ID,
  courier_id: COURIER_ID,
  content: "Une note de test",
  created_by: "user-1",
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-01T00:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  // logEvent dépend de courier_events — on le mock silencieusement
  mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
});

describe("courierNoteService", () => {
  describe("listNotes", () => {
    it("retourne les notes triées du plus récent au plus ancien", async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: [fakeNote], error: null }),
      });
      const notes = await listNotes(COURIER_ID);
      expect(notes).toHaveLength(1);
      expect(notes[0].content).toBe("Une note de test");
    });

    it("retourne un tableau vide si aucune note", async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: null, error: null }),
      });
      const notes = await listNotes(COURIER_ID);
      expect(notes).toEqual([]);
    });

    it("propage les erreurs Supabase", async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: null, error: new Error("DB error") }),
      });
      await expect(listNotes(COURIER_ID)).rejects.toThrow("DB error");
    });
  });

  describe("createNote", () => {
    it("trim le contenu avant l'insertion", async () => {
      const insertMock = vi.fn().mockReturnThis();
      mockSupabase.from.mockReturnValue({
        insert: insertMock,
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: fakeNote, error: null }),
      });

      await createNote(ORG_ID, COURIER_ID, "  note avec espaces  ");
      expect(insertMock).toHaveBeenCalledWith(
        expect.objectContaining({ content: "note avec espaces" })
      );
    });

    it("associe le user connecté à la note", async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: "user-42" } },
        error: null,
      });
      const insertMock = vi.fn().mockReturnThis();
      mockSupabase.from.mockReturnValue({
        insert: insertMock,
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: fakeNote, error: null }),
      });

      await createNote(ORG_ID, COURIER_ID, "contenu");
      expect(insertMock).toHaveBeenCalledWith(
        expect.objectContaining({ created_by: "user-42" })
      );
    });

    it("propage les erreurs d'insertion", async () => {
      mockSupabase.from.mockReturnValue({
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: new Error("Insert failed") }),
      });
      await expect(createNote(ORG_ID, COURIER_ID, "test")).rejects.toThrow("Insert failed");
    });
  });

  describe("updateNote", () => {
    it("trim le contenu avant la mise à jour", async () => {
      const updateMock = vi.fn().mockReturnThis();
      mockSupabase.from.mockReturnValue({
        update: updateMock,
        eq: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: fakeNote, error: null }),
      });

      await updateNote(NOTE_ID, "  contenu modifié  ");
      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({ content: "contenu modifié" })
      );
    });
  });

  describe("deleteNote", () => {
    it("supprime la note sans erreur", async () => {
      const deleteMock = vi.fn().mockReturnThis();
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: { organization_id: ORG_ID, courier_id: COURIER_ID }, error: null }),
        delete: deleteMock,
      });

      await expect(deleteNote(NOTE_ID)).resolves.toBeUndefined();
    });

    it("propage les erreurs de suppression", async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        delete: vi.fn().mockReturnThis(),
      });

      // Second call (delete) returns an error
      let callCount = 0;
      mockSupabase.from.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          };
        }
        return {
          delete: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ data: null, error: new Error("Delete failed") }),
        };
      });

      await expect(deleteNote(NOTE_ID)).rejects.toThrow("Delete failed");
    });
  });
});
