import { describe, expect, it } from "vitest";
import {
  countersFromProcedurePlan,
  mapSocleProcedure,
  normalizeName,
  planMirrorSync,
  planProcedureSync,
  procedureNeedsUpdate,
  type MirrorRow,
  type ProcedureRow,
  type SocleProcedure,
} from "../../../supabase/functions/sync-socle-referentiel/logic";

const T0 = "2026-07-11T03:00:00.000Z";
const T1 = "2026-07-12T03:00:00.000Z";

function makeSocleProcedure(overrides: Partial<SocleProcedure> = {}): SocleProcedure {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    organization_id: "aaaaaaaa-0000-0000-0000-000000000000",
    category_id: "cccccccc-0000-0000-0000-000000000000",
    name: "Acte de naissance",
    type: "externe",
    keywords: ["état civil", "naissance"],
    short_description: "Demande d'acte de naissance",
    user_description: "Description usager",
    agent_description: "Description agent",
    input_duration_minutes: 10,
    order_index: 3,
    requester_config: { citoyen: { enabled: true, fields: { email: "obligatoire" } } },
    form_schema: {
      version: 1,
      content: [{ id: "f1", key: "motif", label: "Motif", type: "text", required: true }],
    },
    knowledge_base: { agentHelpText: "Aide", agentDocuments: [{ path: "docs/a.pdf", name: "A" }] },
    translations: { en: { name: "Birth certificate" } },
    ...overrides,
  };
}

function makeEmbryo(overrides: Partial<ProcedureRow> = {}): ProcedureRow {
  return {
    id: "e0000000-0000-0000-0000-000000000001",
    name: "Démarche locale",
    description: null,
    socle_id: null,
    is_displayed: true,
    display_order: 0,
    obsoleted_at: null,
    type: null,
    keywords: null,
    user_description: null,
    agent_description: null,
    input_duration_minutes: null,
    socle_category_id: null,
    requester_config: null,
    form_schema: null,
    knowledge_base: null,
    translations: null,
    ...overrides,
  };
}

/** Ligne Clara telle qu'elle existe après application du mapping (état post-sync). */
function makeSyncedRow(proc: SocleProcedure, overrides: Partial<ProcedureRow> = {}): ProcedureRow {
  const mapped = mapSocleProcedure(proc, T0);
  return {
    id: `s-${proc.id}`,
    is_displayed: true,
    ...mapped,
    obsoleted_at: null,
    ...overrides,
  } as unknown as ProcedureRow;
}

describe("normalizeName", () => {
  it("ignore casse, accents et espaces multiples", () => {
    expect(normalizeName("  Acte  de   Naissance ")).toBe("acte de naissance");
    expect(normalizeName("Démarche École")).toBe("demarche ecole");
    expect(normalizeName("ÉTAT-CIVIL")).toBe("etat-civil");
  });

  it("fait correspondre deux graphies équivalentes", () => {
    expect(normalizeName("Acte de naissance")).toBe(normalizeName("ACTE DE NAISSANCE"));
    expect(normalizeName("Carte d'identité")).toBe(normalizeName("carte d'identite"));
  });
});

describe("mapSocleProcedure", () => {
  it("mappe les champs descriptifs et conserve les blocs JSON tels quels", () => {
    const proc = makeSocleProcedure();
    const mapped = mapSocleProcedure(proc, T0);

    expect(mapped.name).toBe("Acte de naissance");
    expect(mapped.description).toBe("Demande d'acte de naissance");
    expect(mapped.display_order).toBe(3);
    expect(mapped.type).toBe("externe");
    expect(mapped.socle_id).toBe(proc.id);
    expect(mapped.socle_category_id).toBe(proc.category_id);
    expect(mapped.external_source).toBe("socle");
    expect(mapped.synced_at).toBe(T0);
    expect(mapped.obsoleted_at).toBeNull();

    // Blocs JSON : strictement identiques (UUID Socle internes préservés).
    expect(mapped.requester_config).toEqual(proc.requester_config);
    expect(mapped.form_schema).toEqual(proc.form_schema);
    expect(mapped.knowledge_base).toEqual(proc.knowledge_base);
    expect(mapped.translations).toEqual(proc.translations);
  });

  it("gère les champs nullables (order_index → 0, keywords → [])", () => {
    const mapped = mapSocleProcedure(
      makeSocleProcedure({
        order_index: null,
        keywords: null,
        short_description: null,
        category_id: null,
        requester_config: null,
        form_schema: null,
        knowledge_base: null,
        translations: null,
      }),
      T0,
    );
    expect(mapped.display_order).toBe(0);
    expect(mapped.keywords).toEqual([]);
    expect(mapped.description).toBeNull();
    expect(mapped.socle_category_id).toBeNull();
    expect(mapped.form_schema).toBeNull();
  });

  it("ne touche ni is_displayed ni les champs Arpège", () => {
    const mapped = mapSocleProcedure(makeSocleProcedure(), T0) as unknown as Record<string, unknown>;
    expect(mapped).not.toHaveProperty("is_displayed");
    expect(mapped).not.toHaveProperty("external_reference_id");
    expect(mapped).not.toHaveProperty("arpege_config_fields");
  });
});

describe("procedureNeedsUpdate", () => {
  it("retourne false quand rien n'a changé (synced_at exclu de la comparaison)", () => {
    const proc = makeSocleProcedure();
    const row = makeSyncedRow(proc);
    expect(procedureNeedsUpdate(row, mapSocleProcedure(proc, T1))).toBe(false);
  });

  it("détecte un changement dans un bloc JSON", () => {
    const proc = makeSocleProcedure();
    const row = makeSyncedRow(proc);
    const changed = makeSocleProcedure({
      form_schema: { version: 1, content: [] },
    });
    expect(procedureNeedsUpdate(row, mapSocleProcedure(changed, T1))).toBe(true);
  });

  it("force la mise à jour d'une démarche obsolète réapparue", () => {
    const proc = makeSocleProcedure();
    const row = makeSyncedRow(proc, { obsoleted_at: T0 });
    expect(procedureNeedsUpdate(row, mapSocleProcedure(proc, T1))).toBe(true);
  });
});

describe("planProcedureSync", () => {
  const acteSocle = makeSocleProcedure(); // « Acte de naissance »
  const nouvelleSocle = makeSocleProcedure({
    id: "22222222-2222-2222-2222-222222222222",
    name: "Inscription scolaire",
  });

  it("premier run : insert + adoption par nom + obsolescence des embryons restants", () => {
    const embryoActe = makeEmbryo({
      id: "e-acte",
      name: "ACTE DE NAISSANCE", // graphie différente : le rapprochement est insensible casse/accents
    });
    const embryoTest = makeEmbryo({ id: "e-test", name: "test" });

    const plan = planProcedureSync([embryoActe, embryoTest], [acteSocle, nouvelleSocle], T0);

    expect(plan.toAdopt).toHaveLength(1);
    expect(plan.toAdopt[0]).toMatchObject({ existingId: "e-acte", reactivate: false });
    expect(plan.toInsert.map((p) => p.name)).toEqual(["Inscription scolaire"]);
    expect(plan.toObsolete).toEqual(["e-test"]);
    expect(plan.toUpdate).toHaveLength(0);
    expect(plan.unchanged).toBe(0);

    expect(countersFromProcedurePlan(plan)).toEqual({
      created: 1,
      updated: 0,
      adopted: 1,
      obsoleted: 1,
      unchanged: 0,
    });
  });

  it("second run sur le même état : tout est inchangé (idempotence)", () => {
    // État Clara tel qu'il serait après application du premier run.
    const adopted = makeSyncedRow(acteSocle, { id: "e-acte" });
    const inserted = makeSyncedRow(nouvelleSocle);
    const obsoleted = makeEmbryo({ id: "e-test", name: "test", obsoleted_at: T0, is_displayed: false });

    const plan = planProcedureSync([adopted, inserted, obsoleted], [acteSocle, nouvelleSocle], T1);

    expect(plan.toInsert).toHaveLength(0);
    expect(plan.toAdopt).toHaveLength(0);
    expect(plan.toUpdate).toHaveLength(0);
    expect(plan.toObsolete).toHaveLength(0); // l'embryon déjà obsolète n'est pas re-marqué
    expect(plan.unchanged).toBe(2);
  });

  it("démarche disparue du Socle → obsolescence ; déjà obsolète → rien", () => {
    const known = makeSyncedRow(acteSocle);
    const alreadyObsolete = makeSyncedRow(nouvelleSocle, { obsoleted_at: T0 });

    const plan = planProcedureSync([known, alreadyObsolete], [], T1);

    expect(plan.toObsolete).toEqual([known.id]);
    expect(plan.unchanged).toBe(0);
  });

  it("démarche obsolète réapparue → mise à jour avec réactivation", () => {
    const obsoleteRow = makeSyncedRow(acteSocle, { obsoleted_at: T0, is_displayed: false });

    const plan = planProcedureSync([obsoleteRow], [acteSocle], T1);

    expect(plan.toUpdate).toHaveLength(1);
    expect(plan.toUpdate[0]).toMatchObject({ existingId: obsoleteRow.id, reactivate: true });
    expect(plan.toObsolete).toHaveLength(0);
  });

  it("mise à jour quand un champ Socle change", () => {
    const known = makeSyncedRow(acteSocle);
    const changed = makeSocleProcedure({ short_description: "Nouvelle description" });

    const plan = planProcedureSync([known], [changed], T1);

    expect(plan.toUpdate).toHaveLength(1);
    expect(plan.toUpdate[0]).toMatchObject({ existingId: known.id, reactivate: false });
    expect(plan.unchanged).toBe(0);
  });

  it("plusieurs embryons homonymes : adoption du premier + warning, l'autre devient obsolète", () => {
    const e1 = makeEmbryo({ id: "e-1", name: "Acte de naissance" });
    const e2 = makeEmbryo({ id: "e-2", name: "Acte de Naissance" });

    const plan = planProcedureSync([e1, e2], [acteSocle], T0);

    expect(plan.toAdopt).toHaveLength(1);
    expect(plan.toAdopt[0].existingId).toBe("e-1");
    expect(plan.toObsolete).toEqual(["e-2"]);
    expect(plan.warnings).toHaveLength(1);
  });
});

describe("planMirrorSync", () => {
  const existing: MirrorRow[] = [
    { id: "r-1", socle_id: "c-1", name: "État civil", icon: "FileText", obsoleted_at: null },
    { id: "r-2", socle_id: "c-2", name: "Urbanisme", icon: null, obsoleted_at: null },
  ];

  it("insert / update / obsolete / unchanged", () => {
    const plan = planMirrorSync(existing, [
      { id: "c-1", name: "État civil", icon: "FileText" }, // inchangée
      { id: "c-3", name: "Scolarité", icon: "School" }, // nouvelle
      // c-2 disparue
    ]);

    expect(plan.unchanged).toBe(1);
    expect(plan.toInsert.map((i) => i.id)).toEqual(["c-3"]);
    expect(plan.toObsolete).toEqual(["r-2"]);
    expect(plan.toUpdate).toHaveLength(0);
  });

  it("réactive une entrée obsolète réapparue", () => {
    const obsolete: MirrorRow[] = [
      { id: "r-1", socle_id: "c-1", name: "État civil", icon: null, obsoleted_at: T0 },
    ];
    const plan = planMirrorSync(obsolete, [{ id: "c-1", name: "État civil", icon: null }]);

    expect(plan.toUpdate).toHaveLength(1);
    expect(plan.toUpdate[0].existingId).toBe("r-1");
  });

  it("détecte un changement de libellé ou d'icône", () => {
    const plan = planMirrorSync(existing, [
      { id: "c-1", name: "État civil", icon: "Landmark" }, // icône changée
      { id: "c-2", name: "Urbanisme et habitat", icon: null }, // nom changé
    ]);
    expect(plan.toUpdate).toHaveLength(2);
    expect(plan.toObsolete).toHaveLength(0);
  });
});
