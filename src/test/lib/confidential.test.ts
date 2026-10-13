import { afterEach, describe, expect, it, vi } from "vitest";
import { mockSupabase } from "../mocks/supabase";
import { canClearConfidential, canSetConfidential, hasConfidentialAccess } from "@/lib/permissions";
import { getMailroomCourier } from "@/services/mailroomService";
import { routeCourier, transferCourier } from "@/services/courierRoutingService";
import type { SocleOrgWithConfig } from "@/services/socleOrgConfigService";

afterEach(() => {
  vi.clearAllMocks();
});

describe("droits sur le drapeau confidentiel", () => {
  it("l'attribut seul ouvre la lecture — administrateur compris", () => {
    expect(hasConfidentialAccess({ can_read_confidential: true })).toBe(true);
    expect(hasConfidentialAccess({ can_read_confidential: false })).toBe(false);
    expect(hasConfidentialAccess(null)).toBe(false);
  });

  it("poser : un habilité ou le service courrier (administrateur compris) ; lever : un habilité", () => {
    const gestionnaire = { role: "gestionnaire" };
    expect(canSetConfidential(null, { ...gestionnaire, can_read_confidential: true })).toBe(true);
    expect(canSetConfidential(null, { ...gestionnaire, is_service_courrier: true })).toBe(true);
    expect(canSetConfidential(null, { role: "administrateur" })).toBe(true);
    expect(canSetConfidential(null, gestionnaire)).toBe(false);

    expect(canClearConfidential({ can_read_confidential: true })).toBe(true);
    expect(canClearConfidential({ role: "administrateur" } as never)).toBe(false);
  });
});

describe("routage d'un courrier confidentiel illisible", () => {
  const blindRow = { is_confidential: true, can_read: false, assigned_service: "Accueil", socle_organization_id: "so-1" };
  const org = { id: "so-2", name: "Urbanisme", workflow_id: "wf-1" } as SocleOrgWithConfig;

  it("la fiche vient de la ligne de l'écran, sans lecture de la base", async () => {
    const ref = await getMailroomCourier("org-1", "c-1", blindRow);
    expect(ref).toMatchObject({ id: "c-1", subject: null, blind: true, socle_organization_id: "so-1" });
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });

  it("le routage passe par route_courier_blind, et la notification ne porte pas l'objet", async () => {
    mockSupabase.rpc.mockResolvedValueOnce({ data: { name: "Urbanisme", initial_state_id: "st-1" }, error: null });
    const ref = await getMailroomCourier("org-1", "c-1", blindRow);
    const result = await routeCourier("org-1", ref, org);
    expect(mockSupabase.rpc).toHaveBeenCalledWith("route_courier_blind", {
      p_courier_id: "c-1",
      p_socle_organization_id: "so-2",
      p_transfer: false,
    });
    expect(result).toEqual({ name: "Urbanisme", initialStateId: "st-1" });
  });

  it("un transfert aussi, avec p_transfer", async () => {
    mockSupabase.rpc.mockResolvedValueOnce({ data: { name: "Urbanisme", initial_state_id: null }, error: null });
    const ref = await getMailroomCourier("org-1", "c-1", blindRow);
    await transferCourier("org-1", ref, org);
    expect(mockSupabase.rpc).toHaveBeenCalledWith("route_courier_blind", expect.objectContaining({ p_transfer: true }));
  });
});
