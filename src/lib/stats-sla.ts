/**
 * Statistiques de retard des courriers reçus, par organisation.
 *
 * Le retard se juge sur l'échéance de RÉSOLUTION (`courierSla`, jours ouvrés,
 * objectifs hérités du parent) — la même règle que le badge des listes : on ne
 * la recopie pas en SQL, où les jours fériés et l'héritage divergeraient.
 *
 * - « Traité en retard » : résolu après l'échéance (`missed`).
 * - « En retard, non traité » : échéance dépassée, toujours ouvert (`overdue`).
 * - Taux de retard : (traités en retard + en retard non traités) / reçus.
 *
 * Un courrier dont l'organisation n'a pas d'objectif de résolution ne peut pas
 * être en retard : il est écarté plutôt que de tirer le taux vers un 0 %
 * trompeur.
 */
import {
  courierSla,
  parisDay,
  resolveSlaTargets,
  type CourierSlaInput,
  type DayKey,
  type SlaOrgNode,
} from "@/lib/courier-sla";

export interface SlaFactRow extends CourierSlaInput {
  socle_organization_id: string | null;
}

export type StatsSlaOrg = SlaOrgNode & { name: string };

export interface LateByService {
  /** UUID du miroir, `null` pour les courriers sans organisation. */
  socle_organization_id: string | null;
  service_name: string;
  received: number;
  /** Résolus après l'échéance. */
  late_processed: number;
  /** Échéance dépassée, pas encore résolus. */
  late_open: number;
  /** En pourcentage, une décimale. */
  late_rate: number;
}

export interface LateRateSeries {
  socle_organization_id: string | null;
  service_name: string;
  /** Un taux (%) par mois de `months` ; `null` quand rien n'a été reçu ce mois-là. */
  rates: (number | null)[];
}

export interface LateRateEvolution {
  /** Mois de réception, « AAAA-MM », du plus ancien au plus récent. */
  months: string[];
  series: LateRateSeries[];
}

export const UNASSIGNED_LABEL = "Non assigné";
export const ALL_SERVICES_LABEL = "Toutes organisations";

interface Classified {
  socle_organization_id: string | null;
  day: DayKey;
  late_processed: boolean;
  late_open: boolean;
}

function classify(rows: readonly SlaFactRow[], orgs: readonly SlaOrgNode[], now: Date): Classified[] {
  const out: Classified[] = [];
  for (const row of rows) {
    const targets = resolveSlaTargets(orgs, row.socle_organization_id);
    if (!targets.resolutionDays) continue;
    const day = parisDay(row.received_at ?? row.created_at);
    if (!day) continue;
    const { kind } = courierSla(row, targets, now).resolution;
    out.push({
      socle_organization_id: row.socle_organization_id,
      day,
      late_processed: kind === "missed",
      late_open: kind === "overdue",
    });
  }
  return out;
}

function percent(late: number, received: number): number {
  return received ? Math.round((late / received) * 1000) / 10 : 0;
}

function serviceName(orgs: readonly StatsSlaOrg[], id: string | null): string {
  if (!id) return UNASSIGNED_LABEL;
  return orgs.find((o) => o.id === id)?.name ?? UNASSIGNED_LABEL;
}

interface Tally {
  received: number;
  late: number;
}

/** Retards par organisation, courriers reçus depuis `since` — les plus en retard d'abord. */
export function lateByService(
  rows: readonly SlaFactRow[],
  orgs: readonly StatsSlaOrg[],
  since: Date,
  now: Date = new Date(),
): LateByService[] {
  const sinceDay = parisDay(since)!;
  const groups = new Map<string, LateByService>();
  for (const c of classify(rows, orgs, now)) {
    if (c.day < sinceDay) continue;
    const key = c.socle_organization_id ?? "";
    let g = groups.get(key);
    if (!g) {
      g = {
        socle_organization_id: c.socle_organization_id,
        service_name: serviceName(orgs, c.socle_organization_id),
        received: 0,
        late_processed: 0,
        late_open: 0,
        late_rate: 0,
      };
      groups.set(key, g);
    }
    g.received += 1;
    if (c.late_processed) g.late_processed += 1;
    if (c.late_open) g.late_open += 1;
  }
  return [...groups.values()]
    .map((g) => ({ ...g, late_rate: percent(g.late_processed + g.late_open, g.received) }))
    .sort(
      (a, b) =>
        b.late_processed + b.late_open - (a.late_processed + a.late_open) || b.received - a.received,
    );
}

/** Les `count` derniers mois civils (Paris), mois courant compris. */
export function lastMonths(count: number, now: Date = new Date()): string[] {
  const [y, m] = parisDay(now)!.split("-").map(Number);
  const months: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    months.push(d.toISOString().slice(0, 7));
  }
  return months;
}

/**
 * Taux de retard mois par mois (mois de RÉCEPTION), pour l'ensemble puis pour
 * les `maxServices` organisations qui reçoivent le plus — au-delà, les courbes
 * deviennent illisibles.
 */
export function lateRateEvolution(
  rows: readonly SlaFactRow[],
  orgs: readonly StatsSlaOrg[],
  months: readonly string[],
  maxServices = 5,
  now: Date = new Date(),
): LateRateEvolution {
  const index = new Map(months.map((m, i) => [m, i]));
  const empty = (): Tally[] => months.map(() => ({ received: 0, late: 0 }));
  const total = empty();
  const byService = new Map<string, { id: string | null; tallies: Tally[]; received: number }>();

  for (const c of classify(rows, orgs, now)) {
    const i = index.get(c.day.slice(0, 7));
    if (i === undefined) continue;
    const late = c.late_processed || c.late_open ? 1 : 0;
    total[i].received += 1;
    total[i].late += late;
    const key = c.socle_organization_id ?? "";
    let s = byService.get(key);
    if (!s) {
      s = { id: c.socle_organization_id, tallies: empty(), received: 0 };
      byService.set(key, s);
    }
    s.tallies[i].received += 1;
    s.tallies[i].late += late;
    s.received += 1;
  }

  const toRates = (tallies: Tally[]) =>
    tallies.map((t) => (t.received ? percent(t.late, t.received) : null));

  const top = [...byService.values()].sort((a, b) => b.received - a.received).slice(0, maxServices);
  if (!top.length) return { months: [...months], series: [] };

  return {
    months: [...months],
    series: [
      { socle_organization_id: null, service_name: ALL_SERVICES_LABEL, rates: toRates(total) },
      ...(byService.size > 1
        ? top.map((s) => ({
            socle_organization_id: s.id,
            service_name: serviceName(orgs, s.id),
            rates: toRates(s.tallies),
          }))
        : []),
    ],
  };
}
