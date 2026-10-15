import { describe, expect, it } from "vitest";
import {
  arpegeBusinessPrefill,
  buildFormValues,
  businessRequiredMet,
  demandeurRequiredMet,
  flattenComponents,
  getOptions,
  groupByLabel,
} from "@/lib/arpege-business-form";
import { describeTicketCreation } from "@/lib/ticket-creation-result";
import type { ArpegeFormComponent } from "@/services/procedureService";

const comp = (o: Partial<ArpegeFormComponent> & { DataId: string; Type: string }) =>
  ({ Libelle: o.DataId, ...o }) as unknown as ArpegeFormComponent;

describe("flattenComponents", () => {
  it("aplatit les blocs et propage le libellé du groupe", () => {
    const flat = flattenComponents([
      comp({ DataId: "b", Type: "Bloc", Libelle: "Adresse", Components: [comp({ DataId: "rue", Type: "Texte" })] } as never),
    ]);
    expect(flat).toHaveLength(1);
    expect(flat[0].groupLabel).toBe("Adresse");
  });

  it("ignore les champs frères d'une pièce jointe et les Label_long", () => {
    const flat = flattenComponents([
      comp({ DataId: "t", Type: "Texte" }),
      comp({ DataId: "pj", Type: "Pieces_jointes" }),
      comp({ DataId: "l", Type: "Label_long" }),
    ]);
    expect(flat.map((f) => f.component.DataId)).toEqual(["pj"]);
  });
});

describe("groupByLabel", () => {
  it("regroupe les champs consécutifs d'un même bloc", () => {
    const g = groupByLabel([
      { component: comp({ DataId: "a", Type: "Texte" }), groupLabel: "X" },
      { component: comp({ DataId: "b", Type: "Texte" }), groupLabel: "X" },
      { component: comp({ DataId: "c", Type: "Texte" }), groupLabel: undefined },
    ]);
    expect(g.map((x) => x.items.length)).toEqual([2, 1]);
  });
});

describe("getOptions", () => {
  it("lit Code/Libelle et tolère les variantes de casse", () => {
    const c = comp({ DataId: "o", Type: "Combo_autre", Value: [{ Code: "A", Libelle: "Un" }, { code: "B", libelle: "Deux" }] } as never);
    expect(getOptions(c)).toEqual([{ code: "A", label: "Un" }, { code: "B", label: "Deux" }]);
  });
  it("renvoie [] sans valeurs", () => {
    expect(getOptions(comp({ DataId: "o", Type: "Combo_autre" }))).toEqual([]);
  });
});

describe("buildFormValues / arpegeBusinessPrefill", () => {
  const components = [
    comp({ DataId: "a", Type: "Texte" }),
    comp({ DataId: "b", Type: "Texte" }),
  ];
  it("omet les valeurs vides ou absentes", () => {
    expect(buildFormValues(components, { a: "x", b: "" })).toEqual([{ id: "a", valeur: "x" }]);
  });
  it("ignore les DataId inconnus et les valeurs blanches", () => {
    expect(arpegeBusinessPrefill(components, { a: "x", b: "  ", zzz: "y" })).toEqual({ a: "x" });
  });
});

describe("businessRequiredMet", () => {
  it("exige une pièce jointe sélectionnée", () => {
    const c = [comp({ DataId: "pj", Type: "Pieces_jointes" })];
    expect(businessRequiredMet(c, {}, {})).toBe(false);
    expect(businessRequiredMet(c, {}, { pj: ["d1"] })).toBe(true);
  });
  it("exige une identité complète", () => {
    const c = [comp({ DataId: "id", Type: "Identite" })];
    expect(businessRequiredMet(c, { id: { NomUsage: "Dupont", Prenoms: "" } }, {})).toBe(false);
    expect(businessRequiredMet(c, { id: { NomUsage: "Dupont", Prenoms: "Jo" } }, {})).toBe(true);
  });
  it("ne tient pas compte des champs (facultatif)", () => {
    const c = [comp({ DataId: "a", Type: "Texte", Libelle: "Note (facultatif)" })];
    expect(businessRequiredMet(c, {}, {})).toBe(true);
  });
});

describe("demandeurRequiredMet", () => {
  const fields = [
    { Code: "NOM_USUEL", Obligatoire: true },
    { Code: "AUTRE", Obligatoire: true },
  ];
  it("ne contrôle que les champs affichés", () => {
    expect(demandeurRequiredMet(fields, {})).toBe(false);
    expect(demandeurRequiredMet(fields, { NOM_USUEL: "Dupont" })).toBe(true);
  });
});

describe("describeTicketCreation", () => {
  it("signale un échec Iris en avertissement", () => {
    expect(describeTicketCreation({ irisError: "boom" })).toEqual({
      level: "warning",
      message: "Action créée, non transmise à Iris : boom",
    });
  });
  it("avertit d'une pièce refusée", () => {
    const n = describeTicketCreation({ irisReference: "D-1", attachmentsRefused: "pièce" });
    expect(n.level).toBe("warning");
    expect(n.message).toContain("D-1");
  });
  it("annonce la référence Iris", () => {
    expect(describeTicketCreation({ irisReference: "D-1" }).message).toContain("déposée dans Iris");
  });
  it("reste sobre pour une demande libre", () => {
    expect(describeTicketCreation({})).toEqual({ level: "success", message: "Demande créée" });
  });
});
