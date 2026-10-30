import { describe, expect, it } from "vitest";
import {
  ALL_SERVICES_LABEL,
  lastMonths,
  lateByService,
  lateRateEvolution,
  type SlaFactRow,
  type StatsSlaOrg,
} from "@/lib/stats-sla";

// Racine à 5 jours ouvrés ; « État civil » hérite, « Voirie » n'a aucun objectif
// propre mais hérite aussi ; « Archives » est une seconde racine sans objectif.
const ORGS: StatsSlaOrg[] = [
  { id: "root", socle_id: "s-root", socle_parent_id: null, name: "Mairie", sla_resolution_business_days: 5 },
  { id: "ec", socle_id: "s-ec", socle_parent_id: "s-root", name: "État civil" },
  { id: "voirie", socle_id: "s-voirie", socle_parent_id: "s-root", name: "Voirie", sla_resolution_business_days: 2 },
  { id: "arch", socle_id: "s-arch", socle_parent_id: null, name: "Archives" },
];

// Jeudi 15 octobre 2026, midi à Paris.
const NOW = new Date("2026-10-15T10:00:00Z");

function row(org: string | null, received: string, resolved: string | null = null): SlaFactRow {
  return {
    socle_organization_id: org,
    received_at: received,
    created_at: received,
    acknowledged_at: null,
    resolved_at: resolved,
  };
}

describe("lateByService", () => {
  // Reçu lundi 5/10 : échéance à 5 j ouvrés = lundi 12/10 ; à 2 j = mercredi 7/10.
  const rows = [
    row("ec", "2026-10-05T08:00:00Z", "2026-10-09T08:00:00Z"), // dans les délais
    row("ec", "2026-10-05T08:00:00Z", "2026-10-13T08:00:00Z"), // traité en retard
    row("ec", "2026-10-05T08:00:00Z"), // en retard, ouvert
    row("ec", "2026-10-14T08:00:00Z"), // ouvert, pas encore dû
    row("voirie", "2026-10-05T08:00:00Z", "2026-10-08T08:00:00Z"), // traité en retard (2 j)
    row("arch", "2026-10-01T08:00:00Z"), // sans objectif : écarté
  ];

  it("compte traités en retard, en retard ouverts et le taux sur les reçus", () => {
    const result = lateByService(rows, ORGS, new Date("2026-10-01T00:00:00Z"), NOW);
    expect(result).toEqual([
      {
        socle_organization_id: "ec",
        service_name: "État civil",
        received: 4,
        late_processed: 1,
        late_open: 1,
        late_rate: 50,
      },
      {
        socle_organization_id: "voirie",
        service_name: "Voirie",
        received: 1,
        late_processed: 1,
        late_open: 0,
        late_rate: 100,
      },
    ]);
  });

  it("ne garde que les courriers reçus depuis la date donnée", () => {
    const result = lateByService(rows, ORGS, new Date("2026-10-10T00:00:00Z"), NOW);
    expect(result).toEqual([
      expect.objectContaining({ socle_organization_id: "ec", received: 1, late_processed: 0, late_open: 0 }),
    ]);
  });

  it("range un courrier sans organisation sous « Non assigné » quand la racine est unique", () => {
    const orgs = ORGS.filter((o) => o.id !== "arch");
    const result = lateByService([row(null, "2026-10-05T08:00:00Z")], orgs, new Date("2026-10-01"), NOW);
    expect(result[0]).toMatchObject({ socle_organization_id: null, service_name: "Non assigné", late_open: 1 });
  });
});

describe("lastMonths", () => {
  it("rend les N derniers mois civils, courant compris", () => {
    expect(lastMonths(3, new Date("2026-01-15T12:00:00Z"))).toEqual(["2025-11", "2025-12", "2026-01"]);
  });

  it("raisonne à l'heure de Paris", () => {
    // 31/10 à 23 h 30 UTC = 1er novembre à Paris.
    expect(lastMonths(1, new Date("2026-10-31T23:30:00Z"))).toEqual(["2026-11"]);
  });
});

describe("lateRateEvolution", () => {
  const months = ["2026-08", "2026-09", "2026-10"];
  const rows = [
    row("ec", "2026-09-07T08:00:00Z", "2026-09-30T08:00:00Z"), // en retard
    row("ec", "2026-09-07T08:00:00Z", "2026-09-08T08:00:00Z"), // à l'heure
    row("voirie", "2026-10-05T08:00:00Z"), // en retard, ouvert
    row("voirie", "2026-07-01T08:00:00Z"), // hors fenêtre
  ];

  it("donne un taux mensuel pour l'ensemble puis par service, null sans courrier", () => {
    const result = lateRateEvolution(rows, ORGS, months, 5, NOW);
    expect(result.months).toEqual(months);
    expect(result.series).toEqual([
      { socle_organization_id: null, service_name: ALL_SERVICES_LABEL, rates: [null, 50, 100] },
      { socle_organization_id: "ec", service_name: "État civil", rates: [null, 50, null] },
      { socle_organization_id: "voirie", service_name: "Voirie", rates: [null, null, 100] },
    ]);
  });

  it("limite les courbes aux services qui reçoivent le plus", () => {
    const result = lateRateEvolution(rows, ORGS, months, 1, NOW);
    expect(result.series.map((s) => s.service_name)).toEqual([ALL_SERVICES_LABEL, "État civil"]);
  });

  it("n'ajoute pas de courbe par service quand il n'y en a qu'un", () => {
    const result = lateRateEvolution(rows.slice(0, 2), ORGS, months, 5, NOW);
    expect(result.series.map((s) => s.service_name)).toEqual([ALL_SERVICES_LABEL]);
  });

  it("rend une liste vide sans courrier soumis à un objectif", () => {
    expect(lateRateEvolution([], ORGS, months, 5, NOW).series).toEqual([]);
  });
});
