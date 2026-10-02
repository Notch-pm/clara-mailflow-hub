import { describe, expect, it } from "vitest";
import type { MailroomRow } from "@/services/mailroomService";
import { classifyCourier, type MailroomContext } from "@/lib/mailroom";
import {
  dashboardRoles,
  deadlinePill,
  defaultListRole,
  heroAction,
  instructionList,
  instructionTodo,
  longDate,
  mailroomList,
  monthName,
  parapheurList,
  parapheurTodo,
  scopeLabel,
  sortTodo,
  sparklinePaths,
  trendCharts,
  waitingSub,
  type ParapheurEntry,
  type TrendRow,
} from "@/lib/dashboard";

// Jeudi 1er octobre 2026, midi à Paris.
const NOW = new Date("2026-10-01T10:00:00Z");

const root = { id: "root", socle_id: "s-root", socle_parent_id: null, sla_ack_business_days: 5, sla_resolution_business_days: 10 };
const voirie = { id: "voirie", socle_id: "s-voirie", socle_parent_id: "s-root" };
const ctx: MailroomContext = { assignableIds: new Set(["root", "voirie"]), orgs: [root, voirie], now: NOW };

let seq = 0;
function row(overrides: Partial<MailroomRow> = {}): MailroomRow {
  seq += 1;
  return {
    id: `c${seq}`,
    chrono: `2026-E-${String(seq).padStart(5, "0")}`,
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

const item = (overrides: Partial<MailroomRow> = {}) => classifyCourier(row(overrides), ctx);

/** Routé à la voirie, pris en charge, en instruction. */
const inVoirie = {
  socle_organization_id: "voirie",
  workflow_state_id: "instr",
  state_category: "processing",
  routed_at: "2026-09-30T09:00:00Z",
  taken_at: "2026-09-30T10:00:00Z",
  acknowledged_at: "2026-09-30T10:00:00Z",
};

const voirieScope = new Set(["voirie"]);

describe("dashboardRoles", () => {
  it("cumule les casquettes dans l'ordre des onglets", () => {
    expect(dashboardRoles({ memberOfServices: true, isServiceCourrier: true, canAccessParapheur: true })).toEqual([
      "mailroom",
      "instruction",
      "parapheur",
    ]);
  });

  it("retombe sur l'instruction sans aucune casquette", () => {
    expect(dashboardRoles({ memberOfServices: false, isServiceCourrier: false, canAccessParapheur: false })).toEqual([
      "instruction",
    ]);
  });
});

describe("instructionTodo", () => {
  it("compte retards, prises en charge, relances et brouillons du seul périmètre", () => {
    const items = [
      // En retard : reçu fin août, résolution à 10 jours ouvrés dépassée.
      item({ ...inVoirie, received_at: "2026-08-20T08:00:00Z", created_at: "2026-08-20T08:00:00Z" }),
      item({ ...inVoirie, reminder_count: 2 }),
      item({ socle_organization_id: "voirie", workflow_state_id: "init", state_is_initial: true, routed_at: "2026-09-30T09:00:00Z" }),
      // Hors périmètre.
      item({ ...inVoirie, socle_organization_id: "root", received_at: "2026-08-20T08:00:00Z" }),
      // Résolu : ne compte plus.
      item({ ...inVoirie, resolved_at: "2026-09-30T12:00:00Z", received_at: "2026-08-20T08:00:00Z" }),
    ];
    const cards = Object.fromEntries(instructionTodo(items, voirieScope, 4, true).map((c) => [c.key, c.count]));
    expect(cards).toEqual({
      "instruction-late": 1,
      "instruction-pickup": 1,
      "instruction-reminded": 1,
      "instruction-drafts": 4,
    });
  });

  it("sans périmètre, couvre toute l'organisation", () => {
    const items = [item({ ...inVoirie, received_at: "2026-08-20T08:00:00Z" }), item({ ...inVoirie, socle_organization_id: "root", received_at: "2026-08-20T08:00:00Z" })];
    expect(instructionTodo(items, null, 0, true)[0].count).toBe(2);
  });

  it("un courrier encore à router n'est en retard chez le service que sans service courrier", () => {
    // Arrivé par la boîte de la voirie, à l'état initial, jamais routé ni pris en charge.
    const unrouted = item({
      socle_organization_id: "voirie",
      workflow_state_id: "init",
      state_is_initial: true,
      received_at: "2026-08-20T08:00:00Z",
      created_at: "2026-08-20T08:00:00Z",
    });
    const late = (mailroomActive: boolean) =>
      instructionTodo([unrouted], voirieScope, 0, mailroomActive).find((c) => c.key === "instruction-late")!.count;
    expect(late(true)).toBe(0);
    expect(late(false)).toBe(1);
  });
});

describe("sortTodo", () => {
  it("met le rouge d'abord, retire les cartes vides", () => {
    const cards = sortTodo([
      ...parapheurTodo([], null),
      ...instructionTodo([item({ ...inVoirie, received_at: "2026-08-20T08:00:00Z" })], voirieScope, 3, true),
    ]);
    expect(cards.map((c) => c.key)).toEqual(["instruction-late", "instruction-drafts"]);
  });
});

const entry = (overrides: Partial<ParapheurEntry> = {}): ParapheurEntry => ({
  kind: "visa",
  replyId: "r1",
  parentCourierId: "c1",
  title: "Ralentisseur",
  chrono: "2026-E-00031",
  senderName: "Claire Moreau",
  step: "Visa chef de service",
  waitingDays: 1,
  ...overrides,
});

describe("parapheur", () => {
  it("signale ce qui attend depuis longtemps", () => {
    expect(waitingSub([entry({ waitingDays: 6 }), entry()])).toBe("dont 1 depuis 6 j");
    expect(waitingSub([entry({ waitingDays: 6 }), entry({ waitingDays: 8 })])).toBe("dont 2 depuis 5 j ou plus");
    expect(waitingSub([entry()])).toBe("réponse en attente");
  });

  it("classe la liste par attente, lien vers la réponse", () => {
    const list = parapheurList([entry({ replyId: "a", waitingDays: 2 }), entry({ replyId: "b", kind: "signature", step: "À signer", waitingDays: 6 })]);
    expect(list.rows.map((r) => [r.id, r.end, r.tone])).toEqual([
      ["b", "6 j", "attention"],
      ["a", "2 j", "neutral"],
    ]);
    expect(list.rows[0].href).toBe("/courrier/c1?tab=response&replyId=b&edit=1");
  });

  it("ajoute les retards de l'organisation quand on les lui confie", () => {
    expect(parapheurTodo([], 6).map((c) => c.key)).toContain("parapheur-org-late");
  });
});

describe("listes", () => {
  it("instruction : échéance la plus pressante d'abord", () => {
    const late = item({ ...inVoirie, subject: "Retard", received_at: "2026-08-20T08:00:00Z" });
    const fresh = item({ ...inVoirie, subject: "Récent" });
    const list = instructionList([fresh, late], voirieScope, () => "Analyse technique", NOW);
    expect(list.rows.map((r) => r.title)).toEqual(["Retard", "Récent"]);
    expect(list.rows[0]).toMatchObject({ tone: "urgent", mid: "Analyse technique" });
    expect(list.rows[0].end).toMatch(/^Dépassée de \d+ j$/);
    expect(list.urgentCount).toBe(1);
  });

  it("courrier entrant : propositions par confiance décroissante", () => {
    const list = mailroomList(
      [item({ suggested_service_confidence: 75 }), item({ suggested_service_confidence: 97 })],
      (id) => (id === "voirie" ? "Voirie" : null),
    );
    expect(list.rows.map((r) => [r.end, r.tone, r.mid])).toEqual([
      ["97 %", "good", "Voirie"],
      ["75 %", "attention", "Voirie"],
    ]);
  });

  it("ouvre d'office l'onglet le plus urgent", () => {
    const instruction = instructionList([item({ ...inVoirie, received_at: "2026-08-20T08:00:00Z" })], voirieScope, () => null, NOW);
    const parapheur = parapheurList([entry()]);
    expect(defaultListRole([parapheur, instruction])).toBe("instruction");
    expect(defaultListRole([])).toBeNull();
  });
});

describe("deadlinePill", () => {
  it("rend les quatre cas", () => {
    expect(deadlinePill(undefined, "2026-10-01")).toEqual({ end: "Sans échéance", tone: "neutral" });
    expect(deadlinePill({ kind: "due_soon", dueDay: "2026-10-02", margin: 1 }, "2026-10-01")).toEqual({ end: "2 oct.", tone: "attention" });
    expect(deadlinePill({ kind: "pending", dueDay: "2026-10-14", margin: 9 }, "2026-10-01")).toEqual({ end: "14 oct.", tone: "neutral" });
    expect(deadlinePill({ kind: "overdue", dueDay: "2026-09-28", margin: -3 }, "2026-10-01").tone).toBe("urgent");
  });
});

describe("heroAction", () => {
  const validate = [item({ suggested_service_confidence: 95 }), item({ suggested_service_confidence: 91 })];

  it("service courrier : validation en lot", () => {
    expect(heroAction({ roles: ["mailroom"], instructionLate: 0, mailroomItems: validate })?.label).toBe(
      "Valider les 2 propositions ≥ 90 %",
    );
  });

  it("plusieurs casquettes : les retards de l'agent priment", () => {
    expect(heroAction({ roles: ["instruction", "mailroom"], instructionLate: 2, mailroomItems: validate })?.label).toBe(
      "Traiter mes 2 courriers en retard",
    );
  });

  it("agent seul : pas de bouton", () => {
    expect(heroAction({ roles: ["instruction"], instructionLate: 2, mailroomItems: [] })).toBeNull();
  });
});

describe("tendances", () => {
  const row = (month: string, over: Partial<TrendRow> = {}): TrendRow => ({
    month,
    received: 10,
    open_at_end: 20,
    answered: 5,
    avg_days_to_answer: 10,
    resolved: 8,
    avg_days_to_resolve: 2,
    ...over,
  });

  it("valeur du dernier mois, écart avec le précédent, quel que soit l'ordre reçu", () => {
    const charts = trendCharts([
      row("2026-09", { received: 15, open_at_end: 18, answered: 4, avg_days_to_answer: 8.4, avg_days_to_resolve: 2.5 }),
      row("2026-08"),
    ]);
    const by = Object.fromEntries(charts.map((c) => [c.key, c]));
    expect(charts.map((c) => c.key)).toEqual(["received", "open", "answered", "answer-delay", "resolve-delay"]);
    expect(by.received.points.map((p) => p.label)).toEqual(["août 2026", "septembre 2026"]);
    expect(by.received.points[1].short).toBe("sept. 2026");
    // Le volume reçu ne se juge pas.
    expect(by.received).toMatchObject({ delta: "+50 %", trend: null });
    expect(by.open).toMatchObject({ delta: "−10 %", trend: "good" });
    expect(by.answered).toMatchObject({ delta: "−20 %", trend: "bad" });
    expect(by["answer-delay"]).toMatchObject({ delta: "−1,6 j", trend: "good" });
    expect(by["answer-delay"].points[1].display).toBe("8,4");
    expect(by["resolve-delay"]).toMatchObject({ delta: "+0,5 j", trend: "bad" });
  });

  it("un mois sans réponse : pas de délai, pas d'écart", () => {
    const [, , , delay] = trendCharts([row("2026-08"), row("2026-09", { avg_days_to_answer: null })]);
    expect(delay.points[1].display).toBe("—");
    expect(delay).toMatchObject({ delta: null, trend: null });
  });

  it("un volume parti de zéro n'a pas d'écart en pourcentage", () => {
    const [received] = trendCharts([row("2026-08", { received: 0 }), row("2026-09", { received: 3 })]);
    expect(received.delta).toBeNull();
  });

  it("la courbe se coupe sur un mois sans valeur, une série plate tient au milieu", () => {
    const gap = sparklinePaths([1, 2, null, 3]);
    expect(gap.line.match(/M/g)).toHaveLength(2);
    expect(gap.y[2]).toBeNull();
    expect(sparklinePaths([4, 4, 4]).y).toEqual([16, 16, 16]);
    expect(sparklinePaths([null, null]).line).toBe("");
  });

  it("nomme le mois de la légende", () => {
    expect(monthName("2026-09")).toBe("septembre");
  });
});

describe("en-tête", () => {
  it("date longue à la française", () => {
    expect(longDate(NOW)).toBe("Jeudi 1er octobre 2026");
    expect(longDate(new Date("2026-10-02T10:00:00Z"))).toBe("Vendredi 2 octobre 2026");
  });

  it("résume les casquettes", () => {
    expect(scopeLabel(["instruction", "parapheur", "mailroom"], ["Services techniques"], null)).toBe(
      "Services techniques · service courrier · parapheur",
    );
    expect(scopeLabel(["mailroom"], [], null)).toBe("Service courrier");
    expect(scopeLabel(["instruction"], [], "Mairie de Vernon")).toBe("Mairie de Vernon");
  });
});
