import { describe, expect, it } from "vitest";
import {
  buildSocleDemandeData,
  enabledAudiences,
  evaluateCondition,
  formRequiredMet,
  isFieldRequired,
  parseFormSchema,
  parseLocationValue,
  parseRequesterConfig,
  requesterFieldsFor,
  requesterRequiredMet,
  visibleFields,
  type Condition,
  type SocleFormSchema,
} from "../../lib/socle-form";

// ── Fixtures ────────────────────────────────────────────────────────────────

const schemaWithConditions: SocleFormSchema = {
  version: 1,
  content: [
    {
      id: "type",
      key: "type_demande",
      label: "Type de demande",
      type: "select",
      required: true,
      options: [
        { value: "perte", label: "Perte" },
        { value: "vol", label: "Vol" },
      ],
    },
    {
      id: "num-plainte",
      key: "numero_plainte",
      label: "Numéro de plainte",
      type: "text",
      required: true,
      visibleIf: { combinator: "and", rules: [{ fieldId: "type", operator: "equals", value: "vol" }] },
    },
    {
      id: "sec-detail",
      kind: "section",
      title: "Détails",
      visibleIf: {
        combinator: "and",
        rules: [{ fieldId: "type", operator: "isNotEmpty" }],
      },
      fields: [
        { id: "date-evt", key: "date_evenement", label: "Date", type: "date", required: true },
        {
          id: "pj-plainte",
          key: "pj_plainte",
          label: "Récépissé de plainte",
          type: "attachment",
          maxFiles: 2,
          acceptedFormats: ["pdf"],
          requiredIf: {
            combinator: "and",
            rules: [{ fieldId: "type", operator: "equals", value: "vol" }],
          },
        },
      ],
    },
  ],
};

// ── Conditions ──────────────────────────────────────────────────────────────

describe("evaluateCondition", () => {
  const cond = (combinator: "and" | "or", ...rules: Condition["rules"]): Condition => ({
    combinator,
    rules,
  });

  it("est satisfaite si absente ou sans règle", () => {
    expect(evaluateCondition(undefined, {})).toBe(true);
    expect(evaluateCondition(null, {})).toBe(true);
    expect(evaluateCondition(cond("and"), {})).toBe(true);
  });

  it("equals / notEquals sur scalaire et multi-valeurs", () => {
    const r = { fieldId: "f", operator: "equals" as const, value: "a" };
    expect(evaluateCondition(cond("and", r), { f: "a" })).toBe(true);
    expect(evaluateCondition(cond("and", r), { f: "b" })).toBe(false);
    expect(evaluateCondition(cond("and", r), { f: ["a", "c"] })).toBe(true);
    expect(
      evaluateCondition(cond("and", { fieldId: "f", operator: "notEquals", value: "a" }), {}),
    ).toBe(true);
  });

  it("isEmpty / isNotEmpty (chaîne vide, tableau vide, absent)", () => {
    const empty = { fieldId: "f", operator: "isEmpty" as const };
    expect(evaluateCondition(cond("and", empty), {})).toBe(true);
    expect(evaluateCondition(cond("and", empty), { f: "  " })).toBe(true);
    expect(evaluateCondition(cond("and", empty), { f: [] })).toBe(true);
    expect(evaluateCondition(cond("and", empty), { f: "x" })).toBe(false);
  });

  it("combinators and / or", () => {
    const rTrue = { fieldId: "a", operator: "equals" as const, value: "1" };
    const rFalse = { fieldId: "b", operator: "equals" as const, value: "1" };
    const values = { a: "1", b: "2" };
    expect(evaluateCondition(cond("and", rTrue, rFalse), values)).toBe(false);
    expect(evaluateCondition(cond("or", rTrue, rFalse), values)).toBe(true);
  });
});

// ── parseFormSchema ─────────────────────────────────────────────────────────

describe("parseFormSchema", () => {
  it("retombe sur un schéma vide pour null ou structure invalide", () => {
    expect(parseFormSchema(null)).toEqual({ version: 1, content: [] });
    expect(parseFormSchema("garbage")).toEqual({ version: 1, content: [] });
    expect(parseFormSchema({ version: 2, content: "nope" })).toEqual({ version: 1, content: [] });
  });

  it("parse un schéma valide avec sections, choix et pièces jointes", () => {
    const parsed = parseFormSchema(schemaWithConditions);
    expect(parsed.content).toHaveLength(3);
    const section = parsed.content[2];
    expect("kind" in section && section.kind).toBe("section");
  });

  // Régression du 2026-09-23 : la démarche « Signaler un problème dans l'espace
  // public » (Rosny) ouvrait sur un formulaire VIDE — un seul type inconnu
  // (`location`, Socle 1.29.0) faisait échouer le parse de tout le schéma.
  it("lit le champ `location` du Socle 1.29.0 sans perdre les autres champs", () => {
    const parsed = parseFormSchema({
      version: 1,
      content: [
        { id: "ep-lieu", key: "intervention_lieu", type: "location", label: "Lieu d'intervention", required: true },
        { id: "ep-desc", key: "description", type: "textarea", label: "Description", required: true },
      ],
    });
    expect(parsed.content.map((n) => ("type" in n ? n.type : "section"))).toEqual(["location", "textarea"]);
  });

  it("écarte SEUL un champ de type inconnu, à la racine comme dans une section", () => {
    const parsed = parseFormSchema({
      version: 1,
      content: [
        { id: "futur", key: "futur", type: "signature", label: "Type à venir" },
        { id: "desc", key: "description", type: "textarea", label: "Description" },
        {
          id: "s1",
          kind: "section",
          title: "Détails",
          fields: [
            { id: "abime", key: "x", label: "Sans type" },
            { id: "nom", key: "nom", type: "text", label: "Nom" },
          ],
        },
      ],
    });
    expect(parsed.content).toHaveLength(2);
    expect(parsed.content[0]).toMatchObject({ id: "desc" });
    const section = parsed.content[1];
    expect("kind" in section && section.fields.map((f) => f.id)).toEqual(["nom"]);
  });
});

// ── Lieu d'intervention (type `location`) ───────────────────────────────────

describe("parseLocationValue", () => {
  it("lit la forme du contrat et exige une adresse non vide", () => {
    expect(
      parseLocationValue({ address: " 1 Rue X ", lat: 48.87, lon: 2.48, precision: "adresse", adjusted: false }),
    ).toEqual({ address: "1 Rue X", lat: 48.87, lon: 2.48, precision: "adresse", adjusted: false });
    expect(parseLocationValue({ address: "  " })).toBeNull();
    expect(parseLocationValue(null)).toBeNull();
  });

  it("un point incomplet n'est pas un point, une précision hors vocabulaire est nulle", () => {
    expect(parseLocationValue({ address: "Place", lat: 48.8, precision: "gps", adjusted: true })).toEqual({
      address: "Place",
      lat: null,
      lon: null,
      precision: null,
      adjusted: false,
    });
  });

  it("une chaîne (préremplissage IA) devient une adresse sans point", () => {
    expect(parseLocationValue("Parvis de l'église Saint-Lazare")).toEqual({
      address: "Parvis de l'église Saint-Lazare",
      lat: null,
      lon: null,
      precision: null,
      adjusted: false,
    });
  });
});

describe("champ `location` : obligation et payload", () => {
  const schema: SocleFormSchema = {
    version: 1,
    content: [{ id: "ep-lieu", key: "intervention_lieu", type: "location", label: "Lieu d'intervention", required: true }],
  };

  it("un lieu obligatoire n'est satisfait que par une adresse lisible", () => {
    expect(formRequiredMet(schema, {}, {})).toBe(false);
    expect(formRequiredMet(schema, { "ep-lieu": { address: " " } }, {})).toBe(false);
    expect(formRequiredMet(schema, { "ep-lieu": { address: "1 Rue X", lat: null, lon: null } }, {})).toBe(true);
  });

  it("part normalisé dans socle_data, l'adresse en libellé lisible", () => {
    const data = buildSocleDemandeData({
      config: null,
      audience: null,
      requesterValues: {},
      schema,
      formValues: { "ep-lieu": { address: " 1 Rue X ", lat: 48.87, lon: 2.48, precision: "adresse", adjusted: false } },
      attachments: {},
    });
    expect(data.form).toEqual([
      {
        id: "ep-lieu",
        key: "intervention_lieu",
        label: "Lieu d'intervention",
        type: "location",
        value: { address: "1 Rue X", lat: 48.87, lon: 2.48, precision: "adresse", adjusted: false },
        valueLabel: "1 Rue X",
      },
    ]);
  });
});

// ── Visibilité et validation du formulaire ──────────────────────────────────

describe("visibleFields / formRequiredMet", () => {
  it("masque les champs et sections dont la condition n'est pas satisfaite", () => {
    // Rien de saisi : la section (isNotEmpty sur type) et le champ vol sont masqués.
    expect(visibleFields(schemaWithConditions, {}).map((f) => f.id)).toEqual(["type"]);
    // Perte : la section apparaît, le numéro de plainte reste masqué.
    expect(visibleFields(schemaWithConditions, { type: "perte" }).map((f) => f.id)).toEqual([
      "type",
      "date-evt",
      "pj-plainte",
    ]);
    // Vol : tout est visible.
    expect(visibleFields(schemaWithConditions, { type: "vol" }).map((f) => f.id)).toEqual([
      "type",
      "num-plainte",
      "date-evt",
      "pj-plainte",
    ]);
  });

  it("une pièce jointe n'est obligatoire que si requiredIf est satisfaite", () => {
    const pj = visibleFields(schemaWithConditions, { type: "vol" }).find((f) => f.id === "pj-plainte")!;
    expect(isFieldRequired(pj, { type: "vol" })).toBe(true);
    expect(isFieldRequired(pj, { type: "perte" })).toBe(false);
  });

  it("ne bloque pas sur un champ obligatoire masqué par condition", () => {
    // Perte : num-plainte (required) est masqué → seul date-evt bloque.
    expect(formRequiredMet(schemaWithConditions, { type: "perte" }, {})).toBe(false);
    expect(
      formRequiredMet(schemaWithConditions, { type: "perte", "date-evt": "2026-07-01" }, {}),
    ).toBe(true);
  });

  it("exige la pièce jointe et le champ conditionnel quand la condition est satisfaite", () => {
    const values = { type: "vol", "date-evt": "2026-07-01", "num-plainte": "P-123" };
    expect(formRequiredMet(schemaWithConditions, values, {})).toBe(false);
    expect(formRequiredMet(schemaWithConditions, values, { "pj-plainte": ["doc-1"] })).toBe(true);
  });
});

// ── requester_config ────────────────────────────────────────────────────────

describe("parseRequesterConfig / requester helpers", () => {
  const raw = {
    citoyen: {
      enabled: true,
      fields: { civilite: "visible", prenoms: "obligatoire", nom_usuel: "obligatoire", inconnu: "visible" },
    },
    entreprise: { enabled: false, fields: {} },
    autre_public: { enabled: true },
  };

  it("ignore les publics/champs inconnus et complète les manquants (masqué par défaut)", () => {
    const config = parseRequesterConfig(raw);
    expect(enabledAudiences(config)).toEqual(["citoyen"]);
    const fields = requesterFieldsFor(config, "citoyen");
    expect(fields.map((f) => f.key)).toEqual(["civilite", "nom_usuel", "prenoms"]);
    expect(fields.find((f) => f.key === "prenoms")?.required).toBe(true);
    expect(fields.find((f) => f.key === "civilite")?.required).toBe(false);
  });

  it("valide les champs obligatoires du public courant", () => {
    const config = parseRequesterConfig(raw);
    expect(requesterRequiredMet(config, "citoyen", { civilite: "madame" })).toBe(false);
    expect(
      requesterRequiredMet(config, "citoyen", { prenoms: "Jeanne", nom_usuel: "Dupont" }),
    ).toBe(true);
  });

  it("tout est masqué/désactivé pour une config absente", () => {
    const config = parseRequesterConfig(null);
    expect(enabledAudiences(config)).toEqual([]);
    expect(requesterFieldsFor(config, "citoyen")).toEqual([]);
  });
});

// ── Payload persisté ────────────────────────────────────────────────────────

describe("buildSocleDemandeData", () => {
  it("exclut les champs masqués par condition et les valeurs vides", () => {
    const config = parseRequesterConfig({
      citoyen: { enabled: true, fields: { prenoms: "obligatoire", courriel: "visible" } },
    });
    const data = buildSocleDemandeData({
      config,
      audience: "citoyen",
      requesterValues: { prenoms: " Jeanne ", courriel: "", tel_fixe: "0102030405" },
      schema: schemaWithConditions,
      formValues: {
        type: "perte",
        "date-evt": "2026-07-01",
        "num-plainte": "P-999", // masqué (type ≠ vol) → exclu
      },
      attachments: { "pj-plainte": ["doc-1"], orphan: ["doc-2"] },
    });

    expect(data.demandeur).toEqual({
      audience: "citoyen",
      values: { prenoms: "Jeanne" }, // tel_fixe masqué dans la config → exclu
    });
    expect(data.form.map((e) => e.key)).toEqual(["type_demande", "date_evenement"]);
    const choice = data.form.find((e) => e.key === "type_demande");
    expect(choice?.valueLabel).toBe("Perte");
    // Seules les PJ de champs visibles sont conservées.
    expect(data.pieces_jointes).toEqual({ "pj-plainte": ["doc-1"] });
  });
});
