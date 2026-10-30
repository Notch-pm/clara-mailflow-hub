import { describe, expect, it } from "vitest";
import {
  highestRole,
  missingFromFullList,
  planAgent,
  readSocleAgents,
  shouldBan,
  type SocleAgent,
} from "../../../supabase/functions/sync-socle-users/logic";

const ROOT = "socle-root";
const SERVICE = "socle-service";
const UNMIRRORED = "socle-pas-en-miroir";
const mirror = new Map([
  [ROOT, "clara-root"],
  [SERVICE, "clara-service"],
]);

function agent(overrides: Partial<SocleAgent> = {}): SocleAgent {
  return {
    socle_user_id: "u-1",
    email: "alice@ville.fr",
    first_name: "Alice",
    last_name: "Martin",
    status: "active",
    is_active: true,
    accesses: [{ organization_id: SERVICE, role: "gestionnaire", is_active: true }],
    ...overrides,
  };
}

describe("highestRole", () => {
  it("prend le plus élevé ; un code inconnu compte comme le plus faible", () => {
    expect(highestRole(["elu", "superviseur", "gestionnaire"])).toBe("superviseur");
    expect(highestRole(["consultant", "administrateur"])).toBe("administrateur");
    expect(highestRole(["inconnu"])).toBe("consultant");
    expect(highestRole([])).toBe("consultant");
  });
});

describe("planAgent", () => {
  it("nouvel agent : appartenance active, affectation sur l'organisme en miroir", () => {
    expect(planAgent(agent(), null, [], mirror)).toEqual({
      active: true,
      membership: { role: "gestionnaire", is_active: true },
      addAffectations: ["clara-service"],
      removeAffectations: [],
    });
  });

  it("rien ne change : aucune écriture", () => {
    const plan = planAgent(agent(), { id: "m", role: "gestionnaire", is_active: true }, ["clara-service"], mirror);
    expect(plan.membership).toBeNull();
    expect(plan.addAffectations).toEqual([]);
    expect(plan.removeAffectations).toEqual([]);
  });

  it("rôle = le plus élevé des accès ACTIFS ; affectations = exactement ceux-là", () => {
    const plan = planAgent(
      agent({
        accesses: [
          { organization_id: ROOT, role: "elu", is_active: true },
          { organization_id: SERVICE, role: "administrateur", is_active: false },
          { organization_id: UNMIRRORED, role: "superviseur", is_active: true },
        ],
      }),
      { id: "m", role: "gestionnaire", is_active: true },
      ["clara-service"],
      mirror,
    );
    expect(plan.membership).toEqual({ role: "superviseur", is_active: true });
    expect(plan.addAffectations).toEqual(["clara-root"]);
    expect(plan.removeAffectations).toEqual(["clara-service"]);
  });

  it("agent suspendu : appartenance inactive, rôle conservé, affectations retirées", () => {
    const plan = planAgent(
      agent({ status: "suspended", is_active: false }),
      { id: "m", role: "superviseur", is_active: true },
      ["clara-service"],
      mirror,
    );
    expect(plan).toEqual({
      active: false,
      membership: { role: "superviseur", is_active: false },
      addAffectations: [],
      removeAffectations: ["clara-service"],
    });
  });

  it("jamais membre et rien d'actif : rien n'est créé", () => {
    const plan = planAgent(agent({ is_active: false }), null, [], mirror);
    expect(plan.membership).toBeNull();
    expect(plan.active).toBe(false);
  });
});

describe("shouldBan", () => {
  it("plus aucune appartenance active ⇒ banni ; jamais un superadmin", () => {
    expect(shouldBan(0, false)).toBe(true);
    expect(shouldBan(1, false)).toBe(false);
    expect(shouldBan(0, true)).toBe(false);
  });
});

describe("readSocleAgents", () => {
  it("lit la réponse avec tolérance, e-mail en minuscules", () => {
    const { agents, asOf } = readSocleAgents({
      as_of: "2026-10-30T10:00:00Z",
      agents: [
        { socle_user_id: "u-1", email: "Alice@Ville.fr", status: "active", is_active: true, accesses: [{ organization_id: "o", role: "elu", is_active: true }, { role: "x" }] },
        { email: "sans-id@ville.fr" },
        null,
      ],
    });
    expect(asOf).toBe("2026-10-30T10:00:00Z");
    expect(agents).toHaveLength(1);
    expect(agents[0].email).toBe("alice@ville.fr");
    expect(agents[0].accesses).toEqual([{ organization_id: "o", role: "elu", is_active: true }]);
  });

  it("réponse inattendue ⇒ aucun agent (jamais d'exception)", () => {
    expect(readSocleAgents(null).agents).toEqual([]);
    expect(readSocleAgents({ agents: "non" }).agents).toEqual([]);
  });
});

describe("missingFromFullList", () => {
  it("les agents rattachés absents de la liste complète", () => {
    expect(missingFromFullList(["u-1", "u-2"], [agent()])).toEqual(["u-2"]);
  });
});
