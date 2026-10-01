import { describe, expect, it } from "vitest";
import {
  addBusinessDays,
  businessDaysBetween,
  courierSla,
  easterSunday,
  frenchPublicHolidays,
  inheritedSlaTargets,
  isBusinessDay,
  parisDay,
  primarySla,
  resolveSlaTargets,
  slaLabel,
  slaStatus,
  type SlaOrgNode,
} from "@/lib/courier-sla";

describe("jours fériés", () => {
  it("calcule Pâques", () => {
    expect(easterSunday(2026)).toBe("2026-04-05");
    expect(easterSunday(2027)).toBe("2027-03-28");
    expect(easterSunday(2024)).toBe("2024-03-31");
  });

  it("compte les onze fériés de métropole, fêtes mobiles comprises", () => {
    const h = frenchPublicHolidays(2026);
    expect(h.size).toBe(11);
    expect(h.has("2026-04-06")).toBe(true); // lundi de Pâques
    expect(h.has("2026-05-14")).toBe(true); // Ascension
    expect(h.has("2026-05-25")).toBe(true); // lundi de Pentecôte
    expect(h.has("2026-11-11")).toBe(true);
  });

  it("exclut week-ends et fériés des jours ouvrés", () => {
    expect(isBusinessDay("2026-10-02")).toBe(true); // vendredi
    expect(isBusinessDay("2026-10-03")).toBe(false); // samedi
    expect(isBusinessDay("2026-10-04")).toBe(false); // dimanche
    expect(isBusinessDay("2026-11-11")).toBe(false); // mercredi férié
  });
});

describe("addBusinessDays / businessDaysBetween", () => {
  it("ne compte pas le jour de réception", () => {
    expect(addBusinessDays("2026-09-28", 2)).toBe("2026-09-30"); // lundi → mercredi
  });

  it("saute le week-end", () => {
    expect(addBusinessDays("2026-10-01", 2)).toBe("2026-10-05"); // jeudi → lundi
  });

  it("un courrier reçu le samedi court à partir du lundi", () => {
    expect(addBusinessDays("2026-10-03", 1)).toBe("2026-10-05");
  });

  it("saute un férié", () => {
    expect(addBusinessDays("2026-11-10", 1)).toBe("2026-11-12"); // 11 novembre
  });

  it("est l'inverse de addBusinessDays, et signé", () => {
    expect(businessDaysBetween("2026-10-01", "2026-10-05")).toBe(2);
    expect(businessDaysBetween("2026-10-05", "2026-10-01")).toBe(-2);
    expect(businessDaysBetween("2026-10-05", "2026-10-05")).toBe(0);
  });
});

describe("parisDay", () => {
  it("prend le jour civil de Paris, pas celui d'UTC", () => {
    // 22 h 30 UTC le 30 septembre = 0 h 30 le 1er octobre à Paris (UTC+2).
    expect(parisDay("2026-09-30T22:30:00Z")).toBe("2026-10-01");
    expect(parisDay(null)).toBeNull();
    expect(parisDay("n'importe quoi")).toBeNull();
  });
});

describe("resolveSlaTargets", () => {
  const orgs: SlaOrgNode[] = [
    { id: "root", socle_id: "s-root", socle_parent_id: null, sla_ack_business_days: 2, sla_resolution_business_days: 40 },
    { id: "urba", socle_id: "s-urba", socle_parent_id: "s-root", sla_ack_business_days: null, sla_resolution_business_days: 60 },
    { id: "pc", socle_id: "s-pc", socle_parent_id: "s-urba", sla_ack_business_days: 5, sla_resolution_business_days: null },
  ];

  it("chaque délai remonte indépendamment vers le parent", () => {
    expect(resolveSlaTargets(orgs, "pc")).toEqual({ ackDays: 5, resolutionDays: 60 });
    expect(resolveSlaTargets(orgs, "urba")).toEqual({ ackDays: 2, resolutionDays: 60 });
  });

  it("un courrier sans organisation prend ceux de la racine", () => {
    expect(resolveSlaTargets(orgs, null)).toEqual({ ackDays: 2, resolutionDays: 40 });
  });

  it("plusieurs racines : pas de collectivité, pas d'objectif", () => {
    const twoRoots = [...orgs, { id: "r2", socle_id: "s-r2", socle_parent_id: null }];
    expect(resolveSlaTargets(twoRoots, null)).toEqual({ ackDays: null, resolutionDays: null });
  });

  it("organisation inconnue : pas d'objectif", () => {
    expect(resolveSlaTargets(orgs, "ailleurs")).toEqual({ ackDays: null, resolutionDays: null });
  });

  it("indique ce qu'une organisation hériterait", () => {
    expect(inheritedSlaTargets(orgs, orgs[2])).toEqual({ ackDays: 2, resolutionDays: 60 });
    expect(inheritedSlaTargets(orgs, orgs[0])).toEqual({ ackDays: null, resolutionDays: null });
  });
});

describe("slaStatus", () => {
  const base = { startDay: "2026-09-28", targetDays: 2 }; // échéance mercredi 30

  it("sans objectif", () => {
    expect(slaStatus({ ...base, targetDays: null, doneDay: null, today: "2026-09-28" }).kind).toBe("none");
  });

  it("fait le jour de l'échéance = dans les délais", () => {
    const s = slaStatus({ ...base, doneDay: "2026-09-30", today: "2026-10-05" });
    expect(s).toEqual({ kind: "met", dueDay: "2026-09-30", margin: 0 });
  });

  it("fait après l'échéance = hors délai, retard en jours ouvrés", () => {
    const s = slaStatus({ ...base, doneDay: "2026-10-02", today: "2026-10-05" });
    expect(s.kind).toBe("missed");
    expect(s.margin).toBe(-2);
  });

  it("à faire : en attente, proche, dépassé", () => {
    expect(slaStatus({ ...base, doneDay: null, today: "2026-09-28" }).kind).toBe("pending");
    expect(slaStatus({ ...base, doneDay: null, today: "2026-09-29" }).kind).toBe("due_soon");
    expect(slaStatus({ ...base, doneDay: null, today: "2026-09-30" }).kind).toBe("due_soon");
    expect(slaStatus({ ...base, doneDay: null, today: "2026-10-01" }).kind).toBe("overdue");
  });
});

describe("courierSla / primarySla", () => {
  const targets = { ackDays: 2, resolutionDays: 10 };
  const received = { received_at: "2026-09-28T08:00:00Z", created_at: "2026-09-28T08:00:00Z" };

  it("une résolution vaut accusé de réception", () => {
    const sla = courierSla(
      { ...received, acknowledged_at: null, resolved_at: "2026-09-29T10:00:00Z" },
      targets,
      new Date("2026-10-20T10:00:00Z"),
    );
    expect(sla.ack.kind).toBe("met");
    expect(sla.resolution.kind).toBe("met");
  });

  it("l'accusé à faire passe devant la résolution", () => {
    const sla = courierSla(
      { ...received, acknowledged_at: null, resolved_at: null },
      targets,
      new Date("2026-10-01T10:00:00Z"),
    );
    expect(primarySla(sla)).toMatchObject({ axis: "ack", status: { kind: "overdue" } });
  });

  it("une fois l'accusé fait, la résolution prend le relais", () => {
    const sla = courierSla(
      { ...received, acknowledged_at: "2026-09-29T10:00:00Z", resolved_at: null },
      targets,
      new Date("2026-10-01T10:00:00Z"),
    );
    expect(primarySla(sla)).toMatchObject({ axis: "resolution", status: { kind: "pending" } });
  });

  it("sans aucun objectif, rien à afficher", () => {
    const sla = courierSla(
      { ...received, acknowledged_at: null, resolved_at: null },
      { ackDays: null, resolutionDays: null },
    );
    expect(primarySla(sla)).toBeNull();
  });
});

describe("slaLabel", () => {
  it("accorde et nomme les cas", () => {
    expect(slaLabel({ kind: "overdue", dueDay: "2026-09-30", margin: -1 }, "2026-10-01")).toBe(
      "En retard de 1 jour ouvré",
    );
    expect(slaLabel({ kind: "missed", dueDay: "2026-09-30", margin: -2 }, "2026-10-05")).toBe(
      "Hors délai (2 jours ouvrés)",
    );
    expect(slaLabel({ kind: "due_soon", dueDay: "2026-10-01", margin: 0 }, "2026-10-01")).toBe(
      "Échéance aujourd'hui",
    );
    expect(slaLabel({ kind: "pending", dueDay: "2026-10-12", margin: 5 }, "2026-10-01")).toBe(
      "Échéance le 12/10/2026",
    );
  });
});
