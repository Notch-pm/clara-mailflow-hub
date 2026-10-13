import { afterEach, describe, expect, it, vi } from "vitest";
import { mockSupabase } from "../mocks/supabase";
import { createOutboundCourier, recipientSnapshot } from "@/services/outboundCourierService";
import type { SocleContact } from "@/services/socleContactService";

const CONTACT = {
  id: "c-1",
  contact_type: "personne",
  civility: "monsieur",
  first_name: "Jean",
  last_name: "Martin",
  legal_name: null,
  display_name: "Jean Martin",
  email: "jean.martin@example.org",
  mobile_phone: null,
  landline_phone: "02 32 00 00 00",
  address_line1: "3 rue X",
  address_line2: null,
  postal_code: "27000",
  city: "Évreux",
  internal_notes: "Ne jamais transmettre",
} as unknown as SocleContact;

afterEach(() => {
  vi.clearAllMocks();
});

describe("recipientSnapshot", () => {
  it("garde l'identité et l'adresse de la fiche, rattachée par son identifiant", () => {
    expect(recipientSnapshot(CONTACT)).toEqual({
      socle_contact_id: "c-1",
      name: "Jean Martin",
      first_name: "Jean",
      last_name: "Martin",
      organization: null,
      email: "jean.martin@example.org",
      phone: "02 32 00 00 00",
      address: "3 rue X, 27000 Évreux",
      address_line1: "3 rue X",
      address_line2: null,
      postal_code: "27000",
      city: "Évreux",
    });
  });

  it("ne recopie jamais les notes internes de la fiche", () => {
    expect(JSON.stringify(recipientSnapshot(CONTACT))).not.toContain("Ne jamais transmettre");
  });
});

describe("createOutboundCourier", () => {
  it("passe par la RPC transactionnelle et rend l'identifiant du courrier", async () => {
    mockSupabase.rpc.mockResolvedValueOnce({ data: "s-1", error: null });

    const id = await createOutboundCourier({
      organizationId: "org-1",
      socleOrganizationId: "so-1",
      channel: "paper",
      subject: "Convocation",
      recipient: CONTACT,
    });

    expect(id).toBe("s-1");
    expect(mockSupabase.rpc).toHaveBeenCalledWith("create_outbound_courier", {
      p_organization_id: "org-1",
      p_socle_organization_id: "so-1",
      p_channel: "paper",
      p_subject: "Convocation",
      p_recipient: expect.objectContaining({ socle_contact_id: "c-1", postal_code: "27000" }),
    });
  });

  it("le refus de la base remonte tel quel", async () => {
    const refusal = { message: "Aucun workflow de réponse n'est configuré pour l'organisation « Culture »." };
    mockSupabase.rpc.mockResolvedValueOnce({ data: null, error: refusal });

    await expect(
      createOutboundCourier({
        organizationId: "org-1",
        socleOrganizationId: "so-2",
        channel: "email",
        subject: "X",
        recipient: CONTACT,
      }),
    ).rejects.toBe(refusal);
  });
});
