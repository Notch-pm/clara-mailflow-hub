import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  courierCreationBlockReason,
  IN_MAILBOX_REASON,
  NO_MANAGING_ORG_REASON,
} from "../../../supabase/functions/_shared/courierCreationGuard";

const ORG = "11111111-1111-1111-1111-111111111111";
const STATE = "22222222-2222-2222-2222-222222222222";

describe("création d'action ou de réponse — quand le courrier l'accepte", () => {
  it("refuse sans organisation gestionnaire, même hors de « À instruire »", () => {
    expect(
      courierCreationBlockReason({ socleOrganizationId: null, workflowStateId: STATE, stateIsInitial: false }),
    ).toBe(NO_MANAGING_ORG_REASON);
  });

  it("refuse à l'état initial", () => {
    expect(
      courierCreationBlockReason({ socleOrganizationId: ORG, workflowStateId: STATE, stateIsInitial: true }),
    ).toBe(IN_MAILBOX_REASON);
  });

  it("refuse sans état : le courrier est dans « À instruire »", () => {
    expect(
      courierCreationBlockReason({ socleOrganizationId: ORG, workflowStateId: null, stateIsInitial: null }),
    ).toBe(IN_MAILBOX_REASON);
  });

  it("refuse tant que l'état n'est pas connu, plutôt que d'ouvrir sur un refus de la base", () => {
    expect(
      courierCreationBlockReason({ socleOrganizationId: ORG, workflowStateId: STATE, stateIsInitial: undefined }),
    ).toBe(IN_MAILBOX_REASON);
  });

  it("accepte un courrier orienté et sorti de « À instruire »", () => {
    expect(
      courierCreationBlockReason({ socleOrganizationId: ORG, workflowStateId: STATE, stateIsInitial: false }),
    ).toBeNull();
  });

  it("traite is_initial NULL comme « pas initial », comme la page « À instruire »", () => {
    expect(
      courierCreationBlockReason({ socleOrganizationId: ORG, workflowStateId: STATE, stateIsInitial: null }),
    ).toBeNull();
  });
});

describe("création d'action ou de réponse — l'écran et la base disent la même chose", () => {
  it("le trigger lève mot pour mot les messages de l'écran", () => {
    const dir = join(__dirname, "../../../supabase/migrations");
    // La DERNIÈRE migration qui définit la fonction : c'est elle qui tourne.
    const file = readdirSync(dir)
      .sort()
      .filter((f) => f.endsWith(".sql"))
      .filter((f) => readFileSync(join(dir, f), "utf-8").includes("FUNCTION public.courier_creation_block_reason"))
      .pop();
    expect(file).toBeDefined();
    // En SQL, l'apostrophe se double.
    const sql = readFileSync(join(dir, file!), "utf-8").replace(/''/g, "'");
    expect(sql).toContain(NO_MANAGING_ORG_REASON);
    expect(sql).toContain(IN_MAILBOX_REASON);
  });
});
