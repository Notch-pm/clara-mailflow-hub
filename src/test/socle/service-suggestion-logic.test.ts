import { describe, expect, it } from "vitest";
import {
  buildServiceCatalog,
  resolveSuggestedService,
  selectServiceCandidates,
  serviceSuggestionPromptRules,
  type ServiceCandidate,
} from "../../../supabase/functions/_shared/serviceSuggestion";
import {
  ATTRIBUTIONS_MAX_CHARS,
  attributionsOutcome,
  parseAttributionsResponse,
  planAttributions,
  planPublicDescriptions,
  plainPublicDescription,
  PUBLIC_DESCRIPTION_MAX_CHARS,
} from "../../../supabase/functions/sync-socle-referentiel/logic";

const org = (over: Partial<ServiceCandidate> & { id: string; name: string }): ServiceCandidate => ({
  socle_id: `s-${over.id}`,
  socle_parent_id: null,
  public_description: null,
  workflow_id: "wf",
  ...over,
});

const mairie = org({ id: "mairie", name: "Mairie" });
const ccas = org({
  id: "ccas",
  name: "CCAS",
  socle_parent_id: "s-mairie",
  public_description: "Aides financières, domiciliation, seniors.",
});
const tech = org({ id: "tech", name: "Services techniques", socle_parent_id: "s-mairie" });
const sansWorkflow = org({ id: "fontvieille", name: "Mairie de Fontvieille", workflow_id: null });

describe("selectServiceCandidates", () => {
  it("ne garde que les organisations qui ont un workflow", () => {
    expect(selectServiceCandidates([mairie, ccas, sansWorkflow]).map((o) => o.id)).toEqual(["mairie", "ccas"]);
  });

  it("garde tout quand aucune n'a de workflow", () => {
    const none = [{ ...mairie, workflow_id: null }, sansWorkflow];
    expect(selectServiceCandidates(none)).toHaveLength(2);
  });
});

describe("buildServiceCatalog", () => {
  it("décrit chaque organisation : id, parent, descriptif, démarches", () => {
    const catalog = buildServiceCatalog(
      [ccas, tech],
      new Map([["tech", ["Signalement voirie", "Éclairage public"]]]),
      [mairie, ccas, tech],
    );
    expect(catalog).toBe(
      [
        "- [ccas] CCAS (rattachée à Mairie) — Aides financières, domiciliation, seniors.",
        "- [tech] Services techniques (rattachée à Mairie) — démarches instruites : Signalement voirie, Éclairage public",
      ].join("\n"),
    );
  });

  it("borne le nombre de démarches citées", () => {
    const many = Array.from({ length: 13 }, (_, i) => `D${i}`);
    const catalog = buildServiceCatalog([tech], new Map([["tech", many]]));
    expect(catalog).toContain("D9 (+3)");
    expect(catalog).not.toContain("D10");
  });

  it("au-delà du budget, raccourcit puis retire les descriptifs, jamais les noms", () => {
    const long = { ...ccas, public_description: "x".repeat(1000) };
    const short = buildServiceCatalog([long, tech], new Map(), [mairie, long, tech], 300);
    expect(short).toContain("[ccas] CCAS");
    expect(short).toContain("[tech] Services techniques");
    expect(short.length).toBeLessThanOrEqual(300);
  });

  it("dit quand il n'y a rien", () => {
    expect(buildServiceCatalog([], new Map())).toBe("(aucune organisation)");
  });
});

describe("serviceSuggestionPromptRules", () => {
  it("cite l'organisation déjà désignée et demande de la garder si elle convient", () => {
    const rules = serviceSuggestionPromptRules({ id: "tech", name: "Services techniques" });
    expect(rules).toContain("« Services techniques » [tech]");
    expect(rules).toContain("un doute ne justifie pas un transfert");
    expect(serviceSuggestionPromptRules(null)).not.toContain("DÉJÀ");
  });
});

describe("resolveSuggestedService", () => {
  const candidates = [ccas, tech];

  it("rend l'organisation et la raison", () => {
    expect(resolveSuggestedService({ socle_organization_id: "ccas", reason: " Demande d'aide. " }, candidates)).toEqual({
      id: "ccas",
      name: "CCAS",
      reason: "Demande d'aide.",
      confidence: null,
      alternativeIds: [],
    });
  });

  it("borne la confiance et accepte une fraction", () => {
    const conf = (confidence: unknown) =>
      resolveSuggestedService({ socle_organization_id: "ccas", confidence }, candidates)?.confidence;
    expect(conf(92)).toBe(92);
    expect(conf(0.85)).toBe(85);
    expect(conf("77")).toBe(77);
    expect(conf(140)).toBe(100);
    expect(conf(-3)).toBe(0);
    expect(conf("beaucoup")).toBeNull();
    expect(conf(undefined)).toBeNull();
  });

  it("revalide les alternatives : catalogue seul, sans doublon ni la proposition, deux au plus", () => {
    const s = resolveSuggestedService(
      { socle_organization_id: "ccas", alternative_ids: ["ccas", "zzz", "[tech]", "Services techniques", 3] },
      candidates,
    );
    expect(s?.alternativeIds).toEqual(["tech"]);
    expect(
      resolveSuggestedService({ socle_organization_id: "ccas", alternative_ids: "tech" }, candidates)?.alternativeIds,
    ).toEqual([]);
  });

  it("refuse un identifiant inventé ou hors catalogue", () => {
    expect(resolveSuggestedService({ socle_organization_id: "mairie", reason: "" }, candidates)).toBeNull();
    expect(resolveSuggestedService({ socle_organization_id: "zzz", reason: "" }, candidates)).toBeNull();
  });

  it("tolère crochets et nom recopié, pas une réponse vide", () => {
    expect(resolveSuggestedService({ socle_organization_id: "[tech]" }, candidates)?.id).toBe("tech");
    expect(resolveSuggestedService({ socle_organization_id: "services TECHNIQUES" }, candidates)?.id).toBe("tech");
    expect(resolveSuggestedService({ socle_organization_id: null, reason: "x" }, candidates)).toBeNull();
    expect(resolveSuggestedService(undefined, candidates)).toBeNull();
  });

  it("borne la raison", () => {
    const s = resolveSuggestedService({ socle_organization_id: "ccas", reason: "a".repeat(500) }, candidates);
    expect(s?.reason?.length).toBe(300);
  });
});

describe("descriptifs publics (sync)", () => {
  it("retire le Markdown et tient sur une ligne", () => {
    expect(plainPublicDescription("Le **CCAS** vous [accueille](https://x.fr).\n\n- aides\n- seniors")).toBe(
      "Le CCAS vous accueille. aides seniors",
    );
    expect(plainPublicDescription("   ")).toBeNull();
    expect(plainPublicDescription(42)).toBeNull();
  });

  it("borne la longueur", () => {
    expect(plainPublicDescription("a".repeat(5000))?.length).toBe(PUBLIC_DESCRIPTION_MAX_CHARS);
  });

  it("aligne le miroir sur la réponse, absents remis à NULL, inchangés ignorés", () => {
    const mirror = [
      { id: "1", socle_id: "a", public_description: null },
      { id: "2", socle_id: "b", public_description: "Ancien" },
      { id: "3", socle_id: "c", public_description: "Stable" },
    ];
    const portal = [
      { id: "a", info: { description: "**Nouveau**" } },
      { id: "c", info: { description: "Stable" } },
    ];
    expect(planPublicDescriptions(mirror, portal)).toEqual([
      { id: "1", public_description: "Nouveau" },
      { id: "2", public_description: null },
    ]);
  });
});

describe("attributions (sync)", () => {
  it("lit la réponse en tolérant les entrées incomplètes", () => {
    expect(
      parseAttributionsResponse([
        {
          id: "a",
          name: "Services techniques",
          is_internal_service: true,
          attributions: "**Traite** :\n- voirie\n- éclairage",
          updated_at: null,
        },
        { id: "b", name: "Sans texte" },
        { id: "c", attributions: "   " },
        { attributions: "Sans identifiant" },
        null,
        "x",
        { id: " d ", attributions: "Traite l'état civil." },
      ]),
    ).toEqual([
      { id: "a", attributions: "Traite : • voirie • éclairage" },
      { id: "d", attributions: "Traite l'état civil." },
    ]);
  });

  it("borne le texte", () => {
    const [item] = parseAttributionsResponse([{ id: "a", attributions: "a".repeat(5000) }])!;
    expect(item.attributions.length).toBe(ATTRIBUTIONS_MAX_CHARS);
  });

  it("[] s'applique (rien d'écrit) ; un statut d'erreur ou un corps mal formé gardent l'existant", () => {
    expect(attributionsOutcome(200, [])).toEqual({ kind: "apply", items: [] });
    expect(attributionsOutcome(404, null)).toEqual({ kind: "keep", reason: "le Socle répond 404" });
    expect(attributionsOutcome(400, null).kind).toBe("keep");
    expect(attributionsOutcome(503, null).kind).toBe("keep");
    expect(attributionsOutcome(200, { items: [] })).toEqual({ kind: "keep", reason: "réponse inattendue (pas un tableau)" });
    expect(attributionsOutcome(200, null).kind).toBe("keep");
  });

  it("aligne le miroir : absents remis à NULL, pas d'héritage du parent, inchangés ignorés", () => {
    const mirror = [
      { id: "1", socle_id: "mairie", attributions: null },
      { id: "2", socle_id: "tech", attributions: "Ancien" },
      { id: "3", socle_id: "ccas", attributions: "Stable" },
      { id: "4", socle_id: "voirie", attributions: null },
    ];
    expect(
      planAttributions(mirror, [
        { id: "mairie", attributions: "Tout ce qui n'a pas de service désigné." },
        { id: "ccas", attributions: "Stable" },
      ]),
    ).toEqual([
      { id: "1", attributions: "Tout ce qui n'a pas de service désigné." },
      { id: "2", attributions: null },
    ]);
    expect(planAttributions(mirror, [])).toEqual([
      { id: "2", attributions: null },
      { id: "3", attributions: null },
    ]);
  });
});

describe("catalogue avec attributions", () => {
  const techInterne = org({
    id: "tech",
    name: "Services techniques",
    socle_parent_id: "s-mairie",
    attributions: "Traite : • voirie • éclairage public. Ne traite pas : • espaces verts",
  });
  const ccasDecrit = org({
    id: "ccas",
    name: "CCAS",
    socle_parent_id: "s-mairie",
    public_description: "Aides financières, domiciliation, seniors.",
    attributions: "Traite : • aides sociales • domiciliation",
  });

  it("service interne : bloc « attributions » sans descriptif", () => {
    expect(buildServiceCatalog([techInterne], new Map(), [mairie, techInterne])).toBe(
      "- [tech] Services techniques (rattachée à Mairie) — attributions : Traite : • voirie • éclairage public. Ne traite pas : • espaces verts",
    );
  });

  it("attributions d'abord, descriptif étiqueté « informations usager » ensuite, puis démarches", () => {
    expect(buildServiceCatalog([ccasDecrit], new Map([["ccas", ["Aide d'urgence"]]]), [mairie, ccasDecrit])).toBe(
      "- [ccas] CCAS (rattachée à Mairie) — attributions : Traite : • aides sociales • domiciliation — informations usager : Aides financières, domiciliation, seniors. — démarches instruites : Aide d'urgence",
    );
  });

  it("sans attributions : la ligne d'avant, inchangée", () => {
    expect(buildServiceCatalog([ccas], new Map(), [mairie, ccas])).toBe(
      "- [ccas] CCAS (rattachée à Mairie) — Aides financières, domiciliation, seniors.",
    );
  });

  it("au-delà du budget, le descriptif part avant que les attributions ne raccourcissent", () => {
    const longDesc = { ...ccasDecrit, public_description: "d".repeat(400) };
    const catalog = buildServiceCatalog([longDesc], new Map(), [mairie, longDesc], 200);
    expect(catalog).toContain("attributions : Traite : • aides sociales • domiciliation");
    expect(catalog).not.toContain("informations usager");
  });

  it("le prompt demande de s'appuyer d'abord sur les attributions", () => {
    expect(serviceSuggestionPromptRules(null)).toContain("D'ABORD sur les « attributions »");
  });
});
