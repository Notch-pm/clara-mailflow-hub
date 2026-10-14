import { describe, expect, it } from "vitest";
import { pendingAnalysisItems, type PendingAnalysisArgs } from "@/lib/analysis-pending";

const base: PendingAnalysisArgs = {
  analysis: {
    suggested_subject: "Élagage des platanes",
    intents: ["Voirie", "Mécontent"],
    suggested_socle_organization_id: "org-ev",
    suggested_service_name: "Espaces verts",
  },
  subject: "Courrier numérisé — à qualifier",
  appliedTags: [],
  service: { currentId: null, isInitialState: true, assignableIds: ["org-ev"], transferableIds: [] },
};

describe("pendingAnalysisItems", () => {
  it("compte titre, chaque tag et l'organisation tant que rien n'est appliqué", () => {
    expect(pendingAnalysisItems(base).map((i) => i.kind)).toEqual(["title", "tag", "tag", "service"]);
  });

  it("sans analyse, rien n'attend", () => {
    expect(pendingAnalysisItems({ ...base, analysis: null })).toEqual([]);
  });

  it("titre déjà repris (espaces près) : plus compté", () => {
    const items = pendingAnalysisItems({ ...base, subject: "  Élagage des platanes " });
    expect(items.some((i) => i.kind === "title")).toBe(false);
  });

  it("tags déjà posés, sans tenir compte de la casse", () => {
    const items = pendingAnalysisItems({ ...base, appliedTags: ["voirie"] });
    expect(items.filter((i) => i.kind === "tag").map((i) => i.label)).toEqual(["Tag « Mécontent »"]);
  });

  it("organisation déjà en place : rien à faire", () => {
    const items = pendingAnalysisItems({ ...base, service: { ...base.service, currentId: "org-ev" } });
    expect(items.some((i) => i.kind === "service")).toBe(false);
  });

  it("organisation hors de portée de l'agent : pas de geste possible, pas comptée", () => {
    const items = pendingAnalysisItems({ ...base, service: { ...base.service, assignableIds: [] } });
    expect(items.some((i) => i.kind === "service")).toBe(false);
  });

  it("courrier en cours : un transfert possible compte", () => {
    const items = pendingAnalysisItems({
      ...base,
      service: { currentId: "org-mairie", isInitialState: false, assignableIds: [], transferableIds: ["org-ev"] },
    });
    expect(items.some((i) => i.kind === "service")).toBe(true);
  });
});
