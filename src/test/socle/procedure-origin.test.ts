import { describe, it, expect } from "vitest";
import {
  isPartnerSuspended,
  isRequestableProcedure,
  procedureOrigin,
  procedureOriginLabel,
} from "@/lib/procedure-origin";

describe("procedure-origin — d'où vient une démarche", () => {
  it("reconnaît une démarche du référentiel comme instruite par Iris", () => {
    const p = { external_source: "socle", socle_id: "abc" } as const;
    expect(procedureOrigin(p)).toBe("iris");
    expect(procedureOriginLabel(p)).toBe("Iris");
  });

  it("reconnaît une démarche partenaire à ses références Arpège effectives", () => {
    const p = { external_source: "arpege", external_reference_id: "42", arpege_config_fields: {} };
    expect(procedureOrigin(p)).toBe("arpege");
    expect(procedureOriginLabel(p)).toBe("Arpège");
  });

  it("garde le flux partenaire d'une démarche Arpège adoptée par le Socle", () => {
    // L'adoption réécrit `external_source`, mais les références Arpège
    // survivent : le dépôt reste celui du partenaire.
    expect(
      procedureOrigin({
        external_source: "socle",
        external_reference_id: "42",
        arpege_config_fields: { ConfigInfoUsagerObligs: [] },
      }),
    ).toBe("arpege");
  });

  it("ne prend pas une référence Arpège orpheline pour un flux partenaire", () => {
    // Référence sans config : rien à présenter à l'agent, rien à déposer.
    expect(
      procedureOrigin({ external_source: "socle", external_reference_id: "42" }),
    ).toBe("iris");
  });

  it("classe « local » une démarche sans origine, et refuse d'en faire une demande", () => {
    const p = { external_source: null, external_reference_id: null };
    expect(procedureOrigin(p)).toBe("local");
    expect(procedureOriginLabel(p)).toBeNull();
    expect(isRequestableProcedure(p)).toBe(false);
  });

  it("grise une démarche Arpège quand l'interface du tenant est suspendue, et elle seule", () => {
    const arpege = { external_source: "socle", external_reference_id: "42", arpege_config_fields: {} };
    const iris = { external_source: "socle" };
    expect(isPartnerSuspended(arpege, false)).toBe(true);
    expect(isPartnerSuspended(arpege, true)).toBe(false);
    // Statut pas encore lu : on ne grise rien.
    expect(isPartnerSuspended(arpege, undefined)).toBe(false);
    expect(isPartnerSuspended(iris, false)).toBe(false);
  });

  it("laisse demander tout ce qu'un système instruit", () => {
    expect(isRequestableProcedure({ external_source: "socle" })).toBe(true);
    expect(isRequestableProcedure({ external_source: "arpege" })).toBe(true);
  });
});
