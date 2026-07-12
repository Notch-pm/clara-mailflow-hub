import { describe, expect, it } from "vitest";
import {
  attachSoclePrefill,
  buildPrefillTool,
  buildProcedureCatalog,
  condenseKnowledgeBase,
  DEFAULT_PREFILL_LIMITS,
  extractFillableFields,
  planPrefillCalls,
  sanitizePrefillArguments,
  selectPrefillCandidates,
  splitPrefillCall,
  truncate,
  type ProcedureCatalogEntry,
  type SelectedProcedure,
} from "../../../supabase/functions/analyze-courier/logic";

// ── Fixtures ────────────────────────────────────────────────────────────────

const FORM_SCHEMA = {
  version: 1,
  content: [
    { id: "f-txt", key: "motif", label: "Motif", type: "text", required: true },
    {
      id: "f-sel", key: "type_demande", label: "Type", type: "select",
      options: [{ value: "perte", label: "Perte" }, { value: "vol", label: "Vol" }],
    },
    {
      id: "sec-1", kind: "section", title: "Détails",
      fields: [
        { id: "f-date", key: "date_evt", label: "Date", type: "date" },
        {
          id: "f-cb", key: "creneaux", label: "Créneaux", type: "checkboxes",
          options: [{ value: "matin", label: "Matin" }, { value: "aprem", label: "Après-midi" }],
        },
        { id: "f-pj", key: "photo", label: "Photo", type: "attachment", maxFiles: 1, acceptedFormats: ["pdf"] },
        { id: "f-nokey", key: "", label: "Sans clé", type: "number" },
      ],
    },
  ],
};

function catalogEntry(overrides: Partial<ProcedureCatalogEntry> = {}): ProcedureCatalogEntry {
  return {
    id: "p1",
    name: "Acte de naissance",
    external_source: "socle",
    keywords: ["état civil", "naissance"],
    agent_description: "Délivrance d'une copie d'acte de naissance pour les personnes nées dans la commune.",
    description: "Copie d'acte.",
    ...overrides,
  };
}

function selectedProcedure(overrides: Partial<SelectedProcedure> = {}): SelectedProcedure {
  return {
    id: "p1",
    name: "Objets trouvés",
    fields: extractFillableFields(FORM_SCHEMA),
    knowledge: "",
    ...overrides,
  };
}

// ── truncate ────────────────────────────────────────────────────────────────

describe("truncate", () => {
  it("coupe au mot avec ellipse et normalise les espaces", () => {
    expect(truncate("un  deux\ntrois", 100)).toBe("un deux trois");
    const out = truncate("mot ".repeat(100), 30);
    expect(out.length).toBeLessThanOrEqual(31);
    expect(out.endsWith("…")).toBe(true);
  });
});

// ── buildProcedureCatalog ───────────────────────────────────────────────────

describe("buildProcedureCatalog", () => {
  it("compose une ligne avec source, mots-clés et description (agent_description prioritaire)", () => {
    const block = buildProcedureCatalog([catalogEntry()]);
    expect(block).toContain("[id: p1] Acte de naissance (Socle)");
    expect(block).toContain("mots-clés: état civil, naissance");
    expect(block).toContain("Délivrance d'une copie");
    expect(block).not.toContain("Copie d'acte."); // description ignorée si agent_description présente
  });

  it("retombe sur description si agent_description absente, et gère l'absence des deux", () => {
    expect(buildProcedureCatalog([catalogEntry({ agent_description: null })])).toContain("Copie d'acte.");
    const bare = buildProcedureCatalog([
      catalogEntry({ agent_description: null, description: null, keywords: null }),
    ]);
    expect(bare).toBe("- [id: p1] Acte de naissance (Socle)");
  });

  it("liste vide → mention explicite", () => {
    expect(buildProcedureCatalog([])).toBe("(aucune démarche définie)");
  });

  it("règle dégressive : réduit puis supprime les descriptions quand le bloc est trop long", () => {
    const longDesc = "mot ".repeat(120).trim(); // ~480 chars
    const many = Array.from({ length: 80 }, (_, i) =>
      catalogEntry({ id: `p${i}`, agent_description: longDesc }),
    );
    // 80 lignes à ~220 chars de description ≈ 22k > 15k → descriptions à 120.
    const block = buildProcedureCatalog(many);
    expect(block.length).toBeLessThanOrEqual(25_000);

    const huge = Array.from({ length: 300 }, (_, i) =>
      catalogEntry({ id: `p${i}`, agent_description: longDesc }),
    );
    const compact = buildProcedureCatalog(huge);
    // Descriptions supprimées : chaque ligne se limite à id/nom/mots-clés.
    expect(compact).not.toContain("mot mot");
  });
});

// ── extractFillableFields ───────────────────────────────────────────────────

describe("extractFillableFields", () => {
  it("aplatit racine + sections, exclut les pièces jointes", () => {
    const fields = extractFillableFields(FORM_SCHEMA);
    expect(fields.map((f) => f.id)).toEqual(["f-txt", "f-sel", "f-date", "f-cb", "f-nokey"]);
  });

  it("prefillKey = key, ou id si key vide", () => {
    const fields = extractFillableFields(FORM_SCHEMA);
    expect(fields.find((f) => f.id === "f-sel")?.prefillKey).toBe("type_demande");
    expect(fields.find((f) => f.id === "f-nokey")?.prefillKey).toBe("f-nokey");
  });

  it("dédoublonne les clés (première occurrence gagne) et tolère l'invalide", () => {
    const fields = extractFillableFields({
      version: 1,
      content: [
        { id: "a", key: "dup", label: "A", type: "text" },
        { id: "b", key: "dup", label: "B", type: "text" },
        { id: "c", type: 42 },
        "garbage",
      ],
    });
    expect(fields.map((f) => f.id)).toEqual(["a"]);
    expect(extractFillableFields(null)).toEqual([]);
    expect(extractFillableFields({ content: "nope" })).toEqual([]);
  });
});

// ── condenseKnowledgeBase ───────────────────────────────────────────────────

describe("condenseKnowledgeBase", () => {
  it("condense aide, procédures, 3 premières FAQ et garde-fous", () => {
    const out = condenseKnowledgeBase({
      agentHelpText: "Aide agent.",
      proceduresText: "Étapes internes.",
      faq: [
        { question: "Q1 ?", answer: "R1" },
        { question: "Q2 ?", answer: "R2" },
        { question: "Q3 ?", answer: "R3" },
        { question: "Q4 ?", answer: "R4" },
      ],
      guardrails: ["Ne pas promettre de délai", "Ne pas décider d'attribution"],
    });
    expect(out).toContain("Aide agent : Aide agent.");
    expect(out).toContain("Procédures : Étapes internes.");
    expect(out).toContain("Q: Q3 ?");
    expect(out).not.toContain("Q4");
    expect(out).toContain("Garde-fous : Ne pas promettre de délai ; Ne pas décider d'attribution");
  });

  it("bloc vide ou invalide → chaîne vide", () => {
    expect(condenseKnowledgeBase(null)).toBe("");
    expect(condenseKnowledgeBase({})).toBe("");
    expect(condenseKnowledgeBase({ agentHelpText: "  " })).toBe("");
  });
});

// ── selectPrefillCandidates ─────────────────────────────────────────────────

describe("selectPrefillCandidates", () => {
  const procs = [
    { id: "socle-1", name: "Socle avec form", external_source: "socle", form_schema: FORM_SCHEMA },
    { id: "socle-2", name: "Socle sans form", external_source: "socle", form_schema: { version: 1, content: [] } },
    {
      id: "adopted", name: "Adoptée Arpège", external_source: "socle",
      external_reference_id: "ARP-1", arpege_config_fields: { some: "config" }, form_schema: FORM_SCHEMA,
    },
    { id: "arpege", name: "Pure Arpège", external_source: "arpege", form_schema: FORM_SCHEMA },
  ];

  it("ne retient que les démarches Socle natives avec champs, dédoublonnées dans l'ordre", () => {
    const actions = [
      { procedure_id: "arpege" },
      { procedure_id: "socle-1" },
      { procedure_id: "adopted" },
      { procedure_id: "socle-1" },
      { procedure_id: "socle-2" },
      { procedure_id: null },
    ];
    const selected = selectPrefillCandidates(actions, procs);
    expect(selected.map((s) => s.id)).toEqual(["socle-1"]);
    expect(selected[0].fields.length).toBeGreaterThan(0);
  });

  it("respecte le cap", () => {
    const many = Array.from({ length: 5 }, (_, i) => ({
      id: `s${i}`, name: `S${i}`, external_source: "socle", form_schema: FORM_SCHEMA,
    }));
    const actions = many.map((p) => ({ procedure_id: p.id }));
    expect(selectPrefillCandidates(actions, many, 3)).toHaveLength(3);
  });
});

// ── buildPrefillTool ────────────────────────────────────────────────────────

interface FieldSchema {
  type?: string;
  enum?: string[];
  items?: { type: string; enum: string[] };
  description?: string;
}
interface ProcSchema {
  required: string[];
  properties: {
    audience: { enum: string[] };
    form: { properties: Record<string, FieldSchema>; required: string[] };
  };
}

describe("buildPrefillTool", () => {
  it("génère un schéma contraint par champ (enums, sentinelles) et un bloc de prompt", () => {
    const proc = selectedProcedure({ knowledge: "Aide agent : toujours vérifier la date." });
    const { toolParameters, promptBlock } = buildPrefillTool([proc]);

    const procSchema = (toolParameters.properties as Record<string, ProcSchema>)[proc.id];
    expect(procSchema.required).toEqual(["audience", "form"]);
    expect(procSchema.properties.audience.enum).toEqual(["", "citoyen", "entreprise", "association"]);

    const form = procSchema.properties.form;
    expect(form.properties.type_demande.enum).toEqual(["", "perte", "vol"]);
    expect(form.properties.creneaux).toMatchObject({
      type: "array",
      items: { type: "string", enum: ["matin", "aprem"] },
    });
    expect(form.properties.motif.type).toBe("string");
    expect(form.required).toContain("f-nokey"); // champ sans key → indexé par id
    expect(form.properties.photo).toBeUndefined(); // attachment exclu en amont

    expect(promptBlock).toContain("Démarche « Objets trouvés »");
    expect(promptBlock).toContain("toujours vérifier la date");
  });

  it("les champs ne sont décrits QUE dans le schéma (mapping code=libellé inclus), pas dans le prompt", () => {
    const proc = selectedProcedure();
    const { toolParameters, promptBlock } = buildPrefillTool([proc]);
    const form = (toolParameters.properties as Record<string, ProcSchema>)[proc.id].properties.form;
    // Le mapping des options vit dans la description du champ…
    expect(form.properties.type_demande.description).toContain("perte=Perte");
    expect(form.properties.creneaux.description).toContain("matin=Matin");
    // …et n'est plus dupliqué dans le bloc de prompt.
    expect(promptBlock).not.toContain("perte=Perte");
    expect(promptBlock).not.toContain("Type");
  });
});

// ── planPrefillCalls / splitPrefillCall ─────────────────────────────────────

describe("planPrefillCalls", () => {
  const LIMITS = { maxFieldsPerProcedure: 40, maxSchemaChars: 6_000, contentMaxGrouped: 15_000, contentMaxSplit: 10_000 };

  function bigProcedure(id: string, fieldCount: number): SelectedProcedure {
    return selectedProcedure({
      id,
      fields: extractFillableFields({
        version: 1,
        content: Array.from({ length: fieldCount }, (_, i) => ({
          id: `${id}-f${i}`,
          key: `champ_${i}_avec_un_nom_assez_long_pour_peser`,
          label: `Champ ${i} de la démarche avec un libellé descriptif`,
          type: "text",
        })),
      }),
    });
  }

  it("sous le seuil → un seul appel groupé avec le plafond de contenu standard", () => {
    const calls = planPrefillCalls([selectedProcedure({ id: "a" }), selectedProcedure({ id: "b" })], LIMITS);
    expect(calls).toHaveLength(1);
    expect(calls[0].procedures.map((p) => p.id)).toEqual(["a", "b"]);
    expect(calls[0].contentMax).toBe(15_000);
  });

  it("au-dessus du seuil → un appel par démarche avec contenu réduit", () => {
    const calls = planPrefillCalls([bigProcedure("a", 35), bigProcedure("b", 35), bigProcedure("c", 35)], LIMITS);
    expect(calls.length).toBe(3);
    for (const call of calls) {
      expect(call.procedures).toHaveLength(1);
      expect(call.contentMax).toBe(10_000);
    }
  });

  it("cap de champs par démarche appliqué avant construction du schéma", () => {
    const calls = planPrefillCalls([bigProcedure("a", 60)], LIMITS);
    const fields = calls.flatMap((c) => c.procedures[0].fields);
    expect(fields).toHaveLength(40);
  });

  it("liste vide → aucun appel ; limites par défaut exposées", () => {
    expect(planPrefillCalls([], LIMITS)).toEqual([]);
    expect(DEFAULT_PREFILL_LIMITS.maxSchemaChars).toBeGreaterThan(0);
  });
});

describe("splitPrefillCall", () => {
  it("scinde un appel groupé en appels mono-démarche ; un appel déjà scindé ne se rescinde pas", () => {
    const [grouped] = planPrefillCalls([selectedProcedure({ id: "a" }), selectedProcedure({ id: "b" })]);
    const split = splitPrefillCall(grouped);
    expect(split).toHaveLength(2);
    expect(split.map((c) => c.procedures[0].id)).toEqual(["a", "b"]);
    expect(split[0].contentMax).toBe(DEFAULT_PREFILL_LIMITS.contentMaxSplit);
    expect(splitPrefillCall(split[0])).toEqual([]);
  });
});

// ── sanitizePrefillArguments ────────────────────────────────────────────────

describe("sanitizePrefillArguments", () => {
  const proc = selectedProcedure();

  it("valide options, coercitions et sentinelles", () => {
    const out = sanitizePrefillArguments(
      {
        p1: {
          audience: "citoyen",
          form: {
            motif: "  Perte de badge  ",
            type_demande: "perte",
            date_evt: "2026-07-01",
            creneaux: ["matin", "inconnu"],
            "f-nokey": "3,5",
            inconnu: "dropped",
          },
        },
      },
      [proc],
    );
    expect(out.p1.audience).toBe("citoyen");
    expect(out.p1.form).toEqual({
      motif: "Perte de badge",
      type_demande: "perte",
      date_evt: "2026-07-01",
      creneaux: ["matin"],
      "f-nokey": "3.5",
    });
  });

  it("rejette valeurs invalides et sentinelles vides", () => {
    const out = sanitizePrefillArguments(
      {
        p1: {
          audience: "particulier", // invalide
          form: {
            motif: "",
            type_demande: "PERTE", // pas le code exact
            date_evt: "01/07/2026", // mauvais format
            creneaux: [],
            "f-nokey": "abc",
          },
        },
      },
      [proc],
    );
    // audience invalide → null, form vide → démarche omise
    expect(out.p1).toBeUndefined();
  });

  it("ignore les démarches non soumises et les entrées invalides", () => {
    expect(sanitizePrefillArguments({ autre: { audience: "citoyen", form: {} } }, [proc])).toEqual({});
    expect(sanitizePrefillArguments(null, [proc])).toEqual({});
    expect(sanitizePrefillArguments("garbage", [proc])).toEqual({});
  });

  it("boolean : seul true est conservé", () => {
    const boolProc = selectedProcedure({
      fields: extractFillableFields({
        version: 1,
        content: [
          { id: "b1", key: "accord", label: "Accord", type: "boolean" },
          { id: "b2", key: "refus", label: "Refus", type: "boolean" },
        ],
      }),
    });
    const out = sanitizePrefillArguments(
      { p1: { audience: "", form: { accord: "true", refus: "false" } } },
      [boolProc],
    );
    expect(out.p1.form).toEqual({ accord: true });
    expect(out.p1.audience).toBeNull();
  });
});

// ── attachSoclePrefill ──────────────────────────────────────────────────────

describe("attachSoclePrefill", () => {
  it("attache le prefill à l'action correspondante, laisse les autres intactes", () => {
    const actions = [
      { label: "A", procedure_id: "p1", procedure_name: "P1", prefill: {} },
      { label: "B", procedure_id: "p2", procedure_name: "P2", prefill: {} },
      { label: "C", procedure_id: null, procedure_name: null, prefill: {} },
    ];
    const out = attachSoclePrefill(actions, {
      p1: { audience: "citoyen", form: { motif: "x" } },
    });
    expect(out[0].socle_prefill).toEqual({ audience: "citoyen", form: { motif: "x" } });
    expect(out[1]).not.toHaveProperty("socle_prefill");
    expect(out[2]).not.toHaveProperty("socle_prefill");
  });
});
