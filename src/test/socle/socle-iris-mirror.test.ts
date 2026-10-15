import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { irisPlan } from "../../../supabase/functions/sync-socle-referentiel/iris";

const ROOT = "d5227d25-f327-493a-a9a2-278397531e33";
const SECRETS = { apiUrl: "https://iris.example/functions/v1/requests-api/", platformKeyConfigured: true };

describe("connexion Iris déduite des abonnements du Socle", () => {
  it("abonnée à Iris : ligne ouverte, sans clé (clé plateforme), racine posée", () => {
    expect(irisPlan("ACCM", ROOT, ["clara", "iris", "nora"], SECRETS)).toEqual({
      action: "ouvrir",
      row: {
        api_base_url: "https://iris.example/functions/v1/requests-api",
        api_key: null,
        socle_root_org_id: ROOT,
        is_active: true,
      },
    });
  });

  it("Iris décoché dans le Socle : suspendue, jamais effacée", () => {
    expect(irisPlan("ACCM", ROOT, ["clara"], SECRETS)).toEqual({ action: "suspendre" });
  });

  it("Socle antérieur à 1.42.0 (champ absent) : on ne touche à rien, sans bruit", () => {
    expect(irisPlan("ACCM", ROOT, undefined, SECRETS)).toEqual({ action: "ignorer", warning: null });
  });

  it("clé plateforme ou URL absente : on ne bascule pas, et on le dit", () => {
    for (const secrets of [
      { apiUrl: SECRETS.apiUrl, platformKeyConfigured: false },
      { apiUrl: null, platformKeyConfigured: true },
      { apiUrl: "  ", platformKeyConfigured: true },
    ]) {
      const plan = irisPlan("ACCM", ROOT, ["iris"], secrets);
      expect(plan.action).toBe("ignorer");
      expect(plan.action === "ignorer" && plan.warning).toContain("IRIS_PLATFORM_API_KEY");
    }
  });
});

describe("sync-socle-referentiel — connexion Iris", () => {
  const source = readFileSync(
    join(process.cwd(), "supabase", "functions", "sync-socle-referentiel", "index.ts"),
    "utf8",
  );
  it("écrit par les RPC de service, jamais directement", () => {
    expect(source).toContain('rpc("sync_iris_integration_from_socle"');
    expect(source).toContain('rpc("suspend_iris_integration_from_socle"');
  });
});
