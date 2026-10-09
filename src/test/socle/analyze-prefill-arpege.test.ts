import { describe, expect, it } from "vitest";
import {
  attachPrefills,
  buildPrefillTool,
  extractArpegeFillableFields,
  sanitizePrefillArguments,
  selectPrefillCandidates,
} from "../../../supabase/functions/analyze-courier/logic";

// Le formulaire métier réel de « Propreté Urbaine » (SNA27, 2026-10-09), tel que
// create-arpege-demande l'a recopié depuis une DEMANDE : les `Value` sont celles
// d'un autre usager, pas des options.
const PROPRETE_URBAINE = {
  CodeQualificationMetier: "M_DEM_INTE",
  ConfigInfoUsagerObligs: [],
  FormComponents: [
    {
      Code: "NAT7", Type: "Bloc", Order: 1, Value: [], DataId: "NAT7", Libelle: "Nature du signalement", LibelleAide: "",
      Components: [
        { Code: "NAT", Type: "Combobox", Order: 1, Value: ["Un dépôt sauvage"], DataId: "NAT~@@~NAT7", Libelle: "", LibelleAide: "", Components: [] },
      ],
    },
    {
      Code: "LIE8", Type: "Bloc", Order: 2, Value: [], DataId: "LIE8", Libelle: "Lieu d'intervention", LibelleAide: "",
      Components: [
        {
          Code: "LIE2", Type: "Adresse", Order: 1, DataId: "LIE2~@@~LIE8", Libelle: "", LibelleAide: "", Components: [],
          Value: [{ rue: "Rue Saint Pry", numero: 233, commune: "Béthune", codePostal: "62400" }],
        },
      ],
    },
    {
      Code: "OBJH", Type: "Bloc", Order: 3, Value: [], DataId: "OBJH", Libelle: "Objet de la demande", LibelleAide: "",
      Components: [
        { Code: "OBJK", Type: "Texte_long", Order: 1, Value: ["Machine à laver en panne."], DataId: "OBJK~@@~OBJH", Libelle: "", LibelleAide: "", Components: [] },
      ],
    },
    {
      Code: "PIER", Type: "Bloc", Order: 4, Value: [], DataId: "PIER", Libelle: "Pièces jointes", LibelleAide: "",
      Components: [
        { Code: "PIEZ", Type: "Pieces_jointes", Order: 1, Value: [], DataId: "PIEZ~@@~PIER", Libelle: "", LibelleAide: "", Components: [] },
      ],
    },
  ],
};

describe("extractArpegeFillableFields — le formulaire métier tel que le dialogue le saisit", () => {
  const fields = extractArpegeFillableFields(PROPRETE_URBAINE);

  it("retient la nature, le lieu et l'objet ; écarte les pièces jointes", () => {
    expect(fields.map((f) => [f.id, f.prefillKey, f.label, f.type])).toEqual([
      ["NAT~@@~NAT7", "NAT", "Nature du signalement", "text"],
      ["LIE2~@@~LIE8", "LIE2", "Lieu d'intervention", "location"],
      ["OBJK~@@~OBJH", "OBJK", "Objet de la demande", "textarea"],
    ]);
  });

  it("⚠️ ne prend jamais les valeurs d'une demande passée pour des options", () => {
    expect(fields.every((f) => f.options.length === 0)).toBe(true);
    const description = JSON.stringify(buildPrefillTool([
      { id: "pu", name: "Propreté Urbaine", source: "arpege", fields, knowledge: "" },
    ]).toolParameters);
    expect(description).not.toContain("Béthune");
    expect(description).not.toContain("Machine à laver");
    expect(description).not.toContain("dépôt sauvage");
  });

  it("propose une liste quand Arpège sert de vraies options", () => {
    const withOptions = extractArpegeFillableFields({
      FormComponents: [{
        Code: "URG", Type: "RadiobuttonList", DataId: "URG~@@~B", Libelle: "Urgence", LibelleAide: "", Components: [],
        Value: [{ Code: "N", Libelle: "Normale" }, { Code: "U", Libelle: "Urgent" }],
      }],
    });
    expect(withOptions[0]).toMatchObject({ type: "select", options: [{ value: "N", label: "Normale" }, { value: "U", label: "Urgent" }] });
  });

  it("écarte l'identité et les feuilles voisines d'une pièce jointe ; tolère n'importe quoi", () => {
    expect(extractArpegeFillableFields({
      FormComponents: [{ Code: "ID", Type: "Identite", DataId: "ID", Libelle: "Demandeur", Components: [] }],
    })).toEqual([]);
    expect(extractArpegeFillableFields({
      FormComponents: [{
        Code: "B", Type: "Bloc", DataId: "B", Libelle: "Photo", Components: [
          { Code: "T", Type: "Texte", DataId: "T~@@~B", Libelle: "Titre", Components: [] },
          { Code: "P", Type: "Pieces_jointes", DataId: "P~@@~B", Libelle: "", Components: [] },
        ],
      }],
    })).toEqual([]);
    expect(extractArpegeFillableFields(null)).toEqual([]);
    expect(extractArpegeFillableFields({ FormComponents: "x" })).toEqual([]);
    expect(extractArpegeFillableFields({ some: "config" })).toEqual([]);
  });
});

describe("selectPrefillCandidates — une démarche Arpège se remplit sur ses FormComponents", () => {
  it("retient une démarche adoptée par le Socle qui garde sa config Arpège", () => {
    const selected = selectPrefillCandidates(
      [{ procedure_id: "pu" }],
      [{
        id: "pu", name: "Propreté Urbaine", external_source: "socle",
        external_reference_id: "FLUXNET", arpege_config_fields: PROPRETE_URBAINE, form_schema: null,
      }],
    );
    expect(selected).toHaveLength(1);
    expect(selected[0]).toMatchObject({ id: "pu", source: "arpege" });
    expect(selected[0].fields.map((f) => f.prefillKey)).toEqual(["NAT", "LIE2", "OBJK"]);
  });
});

describe("attachPrefills — chaque préremplissage sous le formulaire qu'il vise", () => {
  const arpege = {
    id: "pu", name: "Propreté Urbaine", source: "arpege" as const,
    fields: extractArpegeFillableFields(PROPRETE_URBAINE), knowledge: "",
  };
  const socle = {
    id: "ep", name: "Espace public", source: "socle" as const,
    fields: [{ id: "f1", prefillKey: "description", label: "Description", type: "textarea", options: [], help: null }],
    knowledge: "",
  };

  it("Arpège : retraduit les codes en DataId, ignore l'audience ; Socle : inchangé", () => {
    const sanitized = sanitizePrefillArguments({
      pu: {
        audience: "citoyen",
        form: { NAT: "Tags sur un muret", LIE2: "12 rue Jean Jaurès, 27200 Vernon", OBJK: "Tags à nettoyer", INCONNU: "x" },
      },
      ep: { audience: "", form: { description: "Lampadaire en panne" } },
    }, [arpege, socle]);

    const out = attachPrefills(
      [
        { label: "Tags", procedure_id: "pu" },
        { label: "Lampadaire", procedure_id: "ep" },
        { label: "Sans démarche", procedure_id: null },
      ],
      sanitized,
      [arpege, socle],
    );

    expect(out[0].arpege_prefill).toEqual({
      "NAT~@@~NAT7": "Tags sur un muret",
      "LIE2~@@~LIE8": "12 rue Jean Jaurès, 27200 Vernon",
      "OBJK~@@~OBJH": "Tags à nettoyer",
    });
    expect(out[0].socle_prefill).toBeUndefined();
    expect(out[1].socle_prefill).toEqual({ audience: null, form: { description: "Lampadaire en panne" } });
    expect(out[1].arpege_prefill).toBeUndefined();
    expect(out[2]).toEqual({ label: "Sans démarche", procedure_id: null });
  });
});
