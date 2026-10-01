import { beforeEach, describe, expect, it, vi } from "vitest";
import "../mocks/supabase";
import { mockSupabase } from "../mocks/supabase";

/**
 * Création d'un courrier « Relayé élu ». Ce qui compte : le canal, l'arrivée
 * en boîte aux lettres (ni organisation ni état), l'usager rattaché à sa fiche
 * du Socle — et qu'une pièce ou un commentaire en échec ne fasse pas perdre la
 * demande de l'usager.
 */

const addParticipant = vi.fn();
const upload = vi.fn();
const createNote = vi.fn();
const enqueueCourierAnalysis = vi.fn();
vi.mock("@/services/courierParticipantService", () => ({ addParticipant }));
vi.mock("@/services/storageService", () => ({ storage: { upload } }));
vi.mock("@/services/courierNoteService", () => ({ createNote }));
vi.mock("@/services/courierAnalysisJobService", () => ({ enqueueCourierAnalysis }));

const { createEluRelayedCourier } = await import("@/services/eluRelayService");

const contact = {
  id: "contact-1",
  display_name: "Marie Dupont",
  first_name: "Marie",
  last_name: "Dupont",
  legal_name: null,
  email: "marie@example.org",
  mobile_phone: "0612345678",
  landline_phone: null,
} as never;

let inserted: Record<string, unknown> | null;

beforeEach(() => {
  vi.clearAllMocks();
  inserted = null;
  addParticipant.mockResolvedValue({});
  upload.mockResolvedValue({});
  createNote.mockResolvedValue({});
  enqueueCourierAnalysis.mockResolvedValue("job-1");
  mockSupabase.from.mockImplementation(() => {
    const b: Record<string, unknown> = {};
    b.insert = vi.fn((row: Record<string, unknown>) => {
      inserted = row;
      return b;
    });
    b.select = vi.fn(() => b);
    b.single = vi.fn(() => b);
    b.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: { id: "courier-1" }, error: null }).then(resolve);
    return b;
  });
});

const base = { organizationId: "org-1", contact, request: "Nid-de-poule rue des Lilas\nDevant le 12", files: [] };

describe("createEluRelayedCourier", () => {
  it("crée un courrier entrant « relaye_elu » en boîte aux lettres, requête dans le corps", async () => {
    const res = await createEluRelayedCourier(base);

    expect(res.courierId).toBe("courier-1");
    expect(inserted).toMatchObject({
      organization_id: "org-1",
      direction: "inbound",
      channel: "relaye_elu",
      subject: "Nid-de-poule rue des Lilas",
      socle_organization_id: null,
      workflow_state_id: null,
      created_by: "user-1",
      metadata: { body_text: "Nid-de-poule rue des Lilas\nDevant le 12", relayed_by: "user-1" },
    });
  });

  it("rattache l'usager comme expéditeur, par sa fiche du Socle", async () => {
    await createEluRelayedCourier(base);
    expect(addParticipant).toHaveBeenCalledWith(
      expect.objectContaining({ courier_id: "courier-1", role: "sender", socle_contact_id: "contact-1", name: "Marie Dupont" }),
    );
  });

  it("refuse une requête vide sans rien créer", async () => {
    await expect(createEluRelayedCourier({ ...base, request: "   " })).rejects.toThrow(/obligatoire/);
    expect(inserted).toBeNull();
  });

  it("une pièce refusée ne défait pas le courrier : elle est signalée", async () => {
    upload.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("Fichier trop volumineux"));
    const files = [new File(["a"], "photo1.jpg"), new File(["b"], "photo2.jpg")];

    const res = await createEluRelayedCourier({ ...base, files });

    expect(upload).toHaveBeenCalledTimes(2);
    expect(res.failedFiles).toEqual([{ name: "photo2.jpg", error: "Fichier trop volumineux" }]);
    expect(res.courierId).toBe("courier-1");
  });

  it("le commentaire interne devient une note ; omis s'il est vide", async () => {
    await createEluRelayedCourier({ ...base, internalComment: "  Rencontrée au marché  " });
    expect(createNote).toHaveBeenCalledWith("org-1", "courier-1", "Rencontrée au marché");

    createNote.mockClear();
    await createEluRelayedCourier({ ...base, internalComment: "  " });
    expect(createNote).not.toHaveBeenCalled();
  });

  it("met l'analyse en file côté serveur, et son échec n'empêche rien", async () => {
    enqueueCourierAnalysis.mockRejectedValueOnce(new Error("file indisponible"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await createEluRelayedCourier(base);
    expect(enqueueCourierAnalysis).toHaveBeenCalledWith("courier-1", "full");
    expect(res.courierId).toBe("courier-1");
  });
});
