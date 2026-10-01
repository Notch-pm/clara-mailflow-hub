import { describe, expect, it } from "vitest";
import type { MailroomRow } from "@/services/mailroomService";
import {
  batchCandidates,
  classifyCourier,
  countViews,
  inView,
  matchesFilters,
  needsRouting,
  slaProgress,
  sortForView,
  trackingTimeline,
  type MailroomContext,
} from "@/lib/mailroom";

// Jeudi 1er octobre 2026, midi à Paris.
const NOW = new Date("2026-10-01T10:00:00Z");

const root = { id: "root", socle_id: "s-root", socle_parent_id: null, sla_ack_business_days: 5, sla_resolution_business_days: 10 };
const voirie = { id: "voirie", socle_id: "s-voirie", socle_parent_id: "s-root" };
const ctx: MailroomContext = { assignableIds: new Set(["root", "voirie"]), orgs: [root, voirie], now: NOW };

function row(overrides: Partial<MailroomRow> = {}): MailroomRow {
  return {
    id: "c1",
    chrono: "2026-E-00001",
    subject: "Trottoir dégradé",
    channel: "email",
    received_at: "2026-09-30T08:00:00Z",
    created_at: "2026-09-30T08:00:00Z",
    socle_organization_id: null,
    assigned_service: null,
    workflow_state_id: null,
    state_is_initial: false,
    state_category: null,
    acknowledged_at: null,
    resolved_at: null,
    sender_name: "Hélène Marchand",
    analysis_status: "done",
    has_analysis: true,
    suggested_socle_organization_id: "voirie",
    suggested_service_reason: "Voirie",
    suggested_service_confidence: 92,
    suggested_service_alternatives: [],
    first_intent: "Réclamation",
    routed_at: null,
    taken_at: null,
    reminder_count: 0,
    last_reminder_at: null,
    returned_from: null,
    returned_at: null,
    returned_done: null,
    returned_todo: null,
    ...overrides,
  };
}

/** Courrier arrivé par une boîte IMAP rattachée à la racine, à l'état initial. */
const preAssigned = { socle_organization_id: "root", assigned_service: "Mairie", workflow_state_id: "init", state_is_initial: true };
const routed = { socle_organization_id: "voirie", assigned_service: "Voirie", workflow_state_id: "init", state_is_initial: true, routed_at: "2026-09-30T09:00:00Z" };

describe("needsRouting", () => {
  it("sans organisation, ou arrivé par une boîte IMAP sans routage ni prise en charge", () => {
    expect(needsRouting(row())).toBe(true);
    expect(needsRouting(row(preAssigned))).toBe(true);
  });

  it("routé, pris en charge, ou déjà en cours sans événement (historique)", () => {
    expect(needsRouting(row(routed))).toBe(false);
    expect(needsRouting(row({ ...preAssigned, taken_at: "2026-09-30T10:00:00Z" }))).toBe(false);
    expect(needsRouting(row({ ...preAssigned, state_is_initial: false }))).toBe(false);
  });

  it("renvoyé au service courrier : à router de nouveau ; résolu : jamais", () => {
    expect(needsRouting(row({ returned_at: "2026-09-30T12:00:00Z" }))).toBe(true);
    expect(needsRouting(row({ resolved_at: "2026-09-30T12:00:00Z" }))).toBe(false);
  });
});

describe("classifyCourier", () => {
  const stage = (o: Partial<MailroomRow>) => classifyCourier(row(o), ctx);

  it("à valider : proposition active et confiance suffisante (ou inconnue)", () => {
    expect(stage({}).stage).toBe("to_validate");
    expect(stage({ suggested_service_confidence: null }).stage).toBe("to_validate");
    expect(stage(preAssigned).stage).toBe("to_validate");
  });

  it("à qualifier, avec la raison qui bloque", () => {
    expect(stage({ has_analysis: false, analysis_status: "failed" })).toMatchObject({ stage: "to_qualify", reason: "analysis_failed" });
    expect(stage({ has_analysis: false, analysis_status: null })).toMatchObject({ stage: "to_qualify", reason: "not_analysed" });
    expect(stage({ suggested_socle_organization_id: null })).toMatchObject({ stage: "to_qualify", reason: "no_suggestion" });
    expect(stage({ suggested_socle_organization_id: "obsolete" })).toMatchObject({ stage: "to_qualify", reason: "unavailable" });
    expect(stage({ suggested_service_confidence: 55 })).toMatchObject({ stage: "to_qualify", reason: "uncertain" });
  });

  it("analyse en cours, même avec une ancienne analyse", () => {
    expect(stage({ analysis_status: "running" }).stage).toBe("analysing");
    expect(stage({ analysis_status: "pending", has_analysis: false }).stage).toBe("analysing");
  });

  it("à réorienter prime sur l'analyse", () => {
    expect(stage({ returned_at: "2026-09-30T12:00:00Z", analysis_status: "running" }).stage).toBe("to_reorient");
  });

  it("en cours, en retard, traité", () => {
    expect(stage(routed).stage).toBe("routed");
    // Reçu le 1er septembre : accusé (5 j ouvrés) dépassé.
    expect(stage({ ...routed, received_at: "2026-09-01T08:00:00Z" }).stage).toBe("late");
    expect(stage({ ...routed, resolved_at: "2026-10-01T08:00:00Z" }).stage).toBe("done");
  });
});

describe("vues", () => {
  const items = [
    classifyCourier(row({ id: "a", received_at: "2026-09-29T08:00:00Z" }), ctx),
    classifyCourier(row({ id: "b", received_at: "2026-09-28T08:00:00Z" }), ctx),
    classifyCourier(row({ id: "c", suggested_service_confidence: 80 }), ctx),
    classifyCourier(row({ id: "d", ...routed }), ctx),
    classifyCourier(row({ id: "e", ...routed, received_at: "2026-09-01T08:00:00Z" }), ctx),
    classifyCourier(row({ id: "f", ...routed, received_at: "2026-08-20T08:00:00Z" }), ctx),
    classifyCourier(row({ id: "g", ...routed, resolved_at: "2026-10-01T07:00:00Z" }), ctx),
    classifyCourier(row({ id: "h", analysis_status: "running" }), ctx),
  ];

  it("compte par onglet, traités du jour compris", () => {
    expect(countViews(items, NOW)).toMatchObject({
      aq: 0, av: 3, retour: 0, cours: 1, retard: 2, traites: 1, traitesToday: 1, tous: 8, analysing: 1,
    });
  });

  it("trie : plus anciens d'abord à valider, plus gros retard d'abord", () => {
    const av = sortForView(items.filter((i) => inView(i, "av")), "av").map((i) => i.row.id);
    expect(av).toEqual(["b", "a", "c"]);
    const retard = sortForView(items.filter((i) => inView(i, "retard")), "retard").map((i) => i.row.id);
    expect(retard).toEqual(["f", "e"]);
  });

  it("lot : uniquement les propositions à confiance connue ≥ 90", () => {
    expect(batchCandidates(items).map((i) => i.row.id)).toEqual(["a", "b"]);
  });

  it("filtre par canal, service et recherche sans accents", () => {
    const item = items[0];
    expect(matchesFilters(item, { query: "helene", channels: [], serviceId: null })).toBe(true);
    expect(matchesFilters(item, { query: "", channels: ["paper"], serviceId: null })).toBe(false);
    expect(matchesFilters(item, { query: "", channels: [], serviceId: "voirie" })).toBe(true);
    expect(matchesFilters(item, { query: "", channels: [], serviceId: "root" })).toBe(false);
  });
});

describe("suivi", () => {
  it("frise : routé, prise en charge attendue, relances, réponse attendue", () => {
    const item = classifyCourier(row({ ...routed, reminder_count: 2, last_reminder_at: "2026-10-01T08:00:00Z" }), ctx);
    expect(trackingTimeline(item, "Email").map((s) => [s.label, s.kind])).toEqual([
      ["Reçu (email)", "done"],
      ["Routé vers Voirie", "done"],
      ["Prise en charge en attente", "todo"],
      ["2 relances envoyées", "warn"],
      ["Réponse attendue", "todo"],
    ]);
  });

  it("avancement vers la résolution, borné", () => {
    const fresh = classifyCourier(row(routed), ctx);
    expect(slaProgress(fresh, NOW)).toBe(10);
    const old = classifyCourier(row({ ...routed, received_at: "2026-08-01T08:00:00Z" }), ctx);
    expect(slaProgress(old, NOW)).toBe(100);
  });
});
