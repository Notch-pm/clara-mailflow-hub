import { describe, expect, it } from "vitest";
import {
  buildActivationIndex,
  filterProceduresForOrganization,
  isProcedureOfferedBy,
  organizationsOfferingProcedure,
} from "@/lib/procedure-activation";
import {
  countersFromActivationPlan,
  hasFullConfig,
  planActivationSync,
  type ActivationItem,
  type ActivationRow,
  type SocleProcedure,
} from "../../../supabase/functions/sync-socle-referentiel/logic";
import { resolveSuggestedOrganization } from "../../../supabase/functions/analyze-courier/logic";

const ECLAIRAGE = "proc-eclairage";
const VOIRIE = "proc-voirie";
const ARPEGE = "proc-arpege";
const ACCM = "org-accm";
const TECHNIQUES = "org-techniques";
const ETAT_CIVIL = "org-etat-civil";

const T0 = "2026-09-09T03:00:00.000Z";

// ── Filtrage côté produit (dialogue de demande, écran Démarches) ─────────────

describe("procedure-activation — quelles démarches propose une organisation", () => {
  const index = buildActivationIndex([
    { procedure_id: ECLAIRAGE, socle_organization_id: ACCM },
    { procedure_id: ECLAIRAGE, socle_organization_id: TECHNIQUES },
    { procedure_id: VOIRIE, socle_organization_id: TECHNIQUES },
  ]);

  it("ne propose une démarche du référentiel qu'aux organisations qui l'assurent", () => {
    expect(isProcedureOfferedBy(index, ECLAIRAGE, TECHNIQUES)).toBe(true);
    expect(isProcedureOfferedBy(index, VOIRIE, ETAT_CIVIL)).toBe(false);
  });

  it("laisse passer une démarche hors référentiel (Arpège, embryon local)", () => {
    // Aucune ligne d'activation : la masquer fermerait le flux partenaire.
    expect(isProcedureOfferedBy(index, ARPEGE, ETAT_CIVIL)).toBe(true);
  });

  it("ne filtre rien tant qu'aucune organisation n'est choisie", () => {
    expect(isProcedureOfferedBy(index, VOIRIE, null)).toBe(true);
  });

  it("filtre une liste de démarches pour une organisation", () => {
    const procedures = [{ id: ECLAIRAGE }, { id: VOIRIE }, { id: ARPEGE }];
    expect(filterProceduresForOrganization(procedures, index, ACCM).map((p) => p.id))
      .toEqual([ECLAIRAGE, ARPEGE]);
    expect(filterProceduresForOrganization(procedures, index, ETAT_CIVIL).map((p) => p.id))
      .toEqual([ARPEGE]);
  });

  it("dit qui assure une démarche (colonne « Assurée par »)", () => {
    expect(organizationsOfferingProcedure(index, ECLAIRAGE).sort()).toEqual([ACCM, TECHNIQUES]);
    expect(organizationsOfferingProcedure(index, ARPEGE)).toEqual([]);
  });

  it("ignore les lignes incomplètes du miroir", () => {
    const dirty = buildActivationIndex([
      { procedure_id: "", socle_organization_id: ACCM },
      { procedure_id: VOIRIE, socle_organization_id: "" },
    ] as never);
    expect(dirty.size).toBe(0);
  });
});

// ── Plan de synchronisation du miroir ───────────────────────────────────────

describe("planActivationSync", () => {
  const item = (p: string, o: string): ActivationItem => ({
    procedure_id: p,
    socle_organization_id: o,
  });
  const row = (p: string, o: string, obsoleted: string | null = null): ActivationRow => ({
    procedure_id: p,
    socle_organization_id: o,
    obsoleted_at: obsoleted,
  });

  it("crée les activations nouvelles et laisse les connues tranquilles", () => {
    const plan = planActivationSync(
      [row(ECLAIRAGE, ACCM)],
      [item(ECLAIRAGE, ACCM), item(VOIRIE, TECHNIQUES)],
      [ACCM, TECHNIQUES],
    );
    expect(plan.toInsert).toEqual([item(VOIRIE, TECHNIQUES)]);
    expect(plan.unchanged).toBe(1);
    expect(plan.toObsolete).toEqual([]);
  });

  it("réactive une activation revenue après retrait", () => {
    const plan = planActivationSync(
      [row(ECLAIRAGE, ACCM, T0)],
      [item(ECLAIRAGE, ACCM)],
      [ACCM],
    );
    expect(plan.toReactivate).toEqual([item(ECLAIRAGE, ACCM)]);
    expect(plan.toInsert).toEqual([]);
  });

  it("retire une activation disparue du référentiel", () => {
    const plan = planActivationSync([row(VOIRIE, TECHNIQUES)], [], [TECHNIQUES]);
    expect(plan.toObsolete).toEqual([item(VOIRIE, TECHNIQUES)]);
  });

  it("ne retire RIEN pour une organisation dont la lecture a échoué", () => {
    // Le cœur de la garde : une organisation muette n'est pas une organisation
    // qui n'assure plus rien. La périmer fermerait son guichet.
    const plan = planActivationSync(
      [row(VOIRIE, TECHNIQUES), row(ECLAIRAGE, ACCM)],
      [item(ECLAIRAGE, ACCM)],
      [ACCM], // TECHNIQUES absente : lecture en échec
    );
    expect(plan.toObsolete).toEqual([]);
    expect(plan.unchanged).toBe(1);
  });

  it("est idempotent : un second passage ne produit que de l'inchangé", () => {
    const incoming = [item(ECLAIRAGE, ACCM), item(VOIRIE, TECHNIQUES)];
    const after = incoming.map((i) => row(i.procedure_id, i.socle_organization_id));
    const plan = planActivationSync(after, incoming, [ACCM, TECHNIQUES]);
    expect(countersFromActivationPlan(plan)).toEqual({
      created: 0, updated: 0, adopted: 0, obsoleted: 0, unchanged: 2,
    });
  });

  it("dédoublonne une activation rendue deux fois", () => {
    const plan = planActivationSync([], [item(ECLAIRAGE, ACCM), item(ECLAIRAGE, ACCM)], [ACCM]);
    expect(plan.toInsert).toHaveLength(1);
  });
});

// ── Économie d'appels : la liste suffit-elle ? ──────────────────────────────

describe("hasFullConfig", () => {
  const listed = {
    id: "p1",
    name: "Demande d'intervention voirie",
    requester_config: null,
    form_schema: { content: [] },
    knowledge_base: null,
    translations: null,
  } as unknown as SocleProcedure;

  it("accepte une démarche dont les blocs de config sont présents, même à null", () => {
    // `null` = démarche sans formulaire : c'est une valeur, pas une absence.
    expect(hasFullConfig(listed)).toBe(true);
  });

  it("réclame le détail quand un bloc manque carrément", () => {
    const { form_schema: _omit, ...amputee } = listed as unknown as Record<string, unknown>;
    expect(hasFullConfig(amputee as unknown as SocleProcedure)).toBe(false);
  });
});

// ── Organisation suggérée par le LLM ────────────────────────────────────────

describe("resolveSuggestedOrganization", () => {
  const accm = { id: ACCM, name: "ACCM" };
  const techniques = { id: TECHNIQUES, name: "Services techniques" };
  const known = new Map([[ACCM, accm], [TECHNIQUES, techniques]]);

  it("retient l'organisation proposée quand elle assure la démarche", () => {
    expect(resolveSuggestedOrganization(TECHNIQUES, [accm, techniques], known)).toEqual(techniques);
  });

  it("refuse une organisation qui n'assure pas la démarche", () => {
    expect(resolveSuggestedOrganization(ETAT_CIVIL, [accm, techniques], known)).toBeNull();
  });

  it("impose la seule organisation qui l'assure, même sans proposition du modèle", () => {
    expect(resolveSuggestedOrganization(null, [techniques], known)).toEqual(techniques);
    expect(resolveSuggestedOrganization("inventé", [techniques], known)).toEqual(techniques);
  });

  it("laisse le choix ouvert quand plusieurs organisations l'assurent", () => {
    expect(resolveSuggestedOrganization(null, [accm, techniques], known)).toBeNull();
  });

  it("accepte toute organisation connue pour une démarche hors référentiel", () => {
    expect(resolveSuggestedOrganization(ACCM, [], known)).toEqual(accm);
    expect(resolveSuggestedOrganization("inventé", [], known)).toBeNull();
    expect(resolveSuggestedOrganization(null, [], known)).toBeNull();
  });
});
