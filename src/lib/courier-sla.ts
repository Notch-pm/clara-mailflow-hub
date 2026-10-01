/**
 * Délais de traitement des courriers reçus (SLA) : accusé de réception et résolution.
 *
 * - Les OBJECTIFS sont en jours ouvrés et portés par les organisations
 *   (`socle_organizations.sla_*_business_days`). Une valeur vide hérite de
 *   l'organisation parente ; la racine porte les délais de la collectivité.
 * - Les FAITS (`couriers.acknowledged_at`, `couriers.resolved_at`) sont posés par
 *   trigger en base (migration `20261001070242_delais_de_traitement.sql`).
 * - Les ÉCHÉANCES se calculent ici, jamais stockées : un objectif modifié vaut
 *   aussitôt pour les courriers en cours.
 *
 * Tout se raisonne en JOURS du calendrier de Paris (« AAAA-MM-JJ »), pas en
 * tranches de 24 h : un courrier reçu lundi à 23 h avec 2 jours ouvrés est dû
 * mercredi, quelle que soit l'heure. Est « dans les délais » ce qui est fait au
 * plus tard le jour de l'échéance.
 */

/** Jour civil, « AAAA-MM-JJ ». */
export type DayKey = string;

const PARIS_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Paris",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Jour civil à Paris d'un instant — `null` si absent ou illisible. */
export function parisDay(value: string | Date | null | undefined): DayKey | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return PARIS_DAY.format(date);
}

// Arithmétique sur des jours civils : on passe par minuit UTC, qui ne connaît
// pas de changement d'heure.
function toUtc(day: DayKey): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function fromUtc(date: Date): DayKey {
  return date.toISOString().slice(0, 10);
}

function shiftDays(day: DayKey, n: number): DayKey {
  const date = toUtc(day);
  date.setUTCDate(date.getUTCDate() + n);
  return fromUtc(date);
}

/** Dimanche de Pâques (algorithme de Meeus/Jones/Butcher, calendrier grégorien). */
export function easterSunday(year: number): DayKey {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return fromUtc(new Date(Date.UTC(year, month - 1, day)));
}

const holidayCache = new Map<number, Set<DayKey>>();

/**
 * Les onze jours fériés de métropole (Code du travail, art. L3133-1), lundi de
 * Pentecôte compris. Les fériés propres à l'Alsace-Moselle (Vendredi saint,
 * 26 décembre) et aux outre-mer ne sont pas comptés.
 */
export function frenchPublicHolidays(year: number): Set<DayKey> {
  const cached = holidayCache.get(year);
  if (cached) return cached;
  const easter = easterSunday(year);
  const fixed = ["01-01", "05-01", "05-08", "07-14", "08-15", "11-01", "11-11", "12-25"].map(
    (md) => `${year}-${md}`,
  );
  const days = new Set<DayKey>([
    ...fixed,
    shiftDays(easter, 1), // lundi de Pâques
    shiftDays(easter, 39), // Ascension
    shiftDays(easter, 50), // lundi de Pentecôte
  ]);
  holidayCache.set(year, days);
  return days;
}

export function isBusinessDay(day: DayKey): boolean {
  const weekday = toUtc(day).getUTCDay();
  if (weekday === 0 || weekday === 6) return false;
  return !frenchPublicHolidays(Number(day.slice(0, 4))).has(day);
}

/** Le N-ième jour ouvré APRÈS `day` (le jour de réception ne compte pas). */
export function addBusinessDays(day: DayKey, n: number): DayKey {
  let current = day;
  let left = n;
  while (left > 0) {
    current = shiftDays(current, 1);
    if (isBusinessDay(current)) left -= 1;
  }
  return current;
}

/**
 * Jours ouvrés entre deux jours civils : nombre de jours ouvrés dans `]from, to]`
 * si `to` est après `from`, son opposé sinon. 0 pour le même jour.
 */
export function businessDaysBetween(from: DayKey, to: DayKey): number {
  if (from === to) return 0;
  const forward = from < to;
  const [start, end] = forward ? [from, to] : [to, from];
  let count = 0;
  for (let d = shiftDays(start, 1); d <= end; d = shiftDays(d, 1)) {
    if (isBusinessDay(d)) count += 1;
  }
  return forward ? count : -count;
}

// ─── Objectifs ──────────────────────────────────────────────────────────────

export interface SlaTargets {
  /** Jours ouvrés avant accusé de réception — `null` : pas d'objectif. */
  ackDays: number | null;
  /** Jours ouvrés avant résolution — `null` : pas d'objectif. */
  resolutionDays: number | null;
}

/** Ce que la résolution d'objectifs lit d'une organisation du miroir. */
export interface SlaOrgNode {
  id: string;
  socle_id: string;
  socle_parent_id: string | null;
  sla_ack_business_days?: number | null;
  sla_resolution_business_days?: number | null;
}

/**
 * Objectifs effectifs d'un courrier : ceux de son organisation, chaque délai
 * remontant indépendamment vers le parent tant qu'il est vide. Un courrier sans
 * organisation (boîte aux lettres) prend ceux de la racine — s'il n'y en a
 * qu'une : un tenant à plusieurs racines n'a pas de « collectivité » à qui se
 * référer.
 */
export function resolveSlaTargets(
  orgs: readonly SlaOrgNode[],
  socleOrganizationId: string | null | undefined,
): SlaTargets {
  const bySocleId = new Map(orgs.map((o) => [o.socle_id, o]));
  let start: SlaOrgNode | undefined;
  if (socleOrganizationId) {
    start = orgs.find((o) => o.id === socleOrganizationId);
  } else {
    const roots = orgs.filter((o) => !o.socle_parent_id || !bySocleId.has(o.socle_parent_id));
    if (roots.length === 1) start = roots[0];
  }

  const targets: SlaTargets = { ackDays: null, resolutionDays: null };
  const seen = new Set<string>();
  for (let node = start; node && !seen.has(node.id); ) {
    seen.add(node.id);
    targets.ackDays ??= node.sla_ack_business_days ?? null;
    targets.resolutionDays ??= node.sla_resolution_business_days ?? null;
    if (targets.ackDays !== null && targets.resolutionDays !== null) break;
    node = node.socle_parent_id ? bySocleId.get(node.socle_parent_id) : undefined;
  }
  return targets;
}

/**
 * Objectifs hérités par une organisation (ce qu'elle aurait si elle laissait ses
 * champs vides) — sert d'indication dans l'écran de paramétrage.
 */
export function inheritedSlaTargets(orgs: readonly SlaOrgNode[], org: SlaOrgNode): SlaTargets {
  if (!org.socle_parent_id) return { ackDays: null, resolutionDays: null };
  const parent = orgs.find((o) => o.socle_id === org.socle_parent_id);
  return parent ? resolveSlaTargets(orgs, parent.id) : { ackDays: null, resolutionDays: null };
}

// ─── Statut d'une échéance ──────────────────────────────────────────────────

export type SlaKind =
  /** Aucun objectif fixé. */
  | "none"
  /** Fait, au plus tard le jour de l'échéance. */
  | "met"
  /** Fait, après l'échéance. */
  | "missed"
  /** À faire, échéance à plus d'un jour ouvré. */
  | "pending"
  /** À faire, échéance aujourd'hui ou au prochain jour ouvré. */
  | "due_soon"
  /** À faire, échéance dépassée. */
  | "overdue";

export interface SlaStatus {
  kind: SlaKind;
  /** Jour de l'échéance, `null` sans objectif. */
  dueDay: DayKey | null;
  /**
   * Jours ouvrés d'écart à l'échéance, vus du jour où c'est fait (ou
   * d'aujourd'hui) : positif = marge restante, négatif = retard.
   */
  margin: number | null;
}

export function slaStatus(args: {
  startDay: DayKey | null;
  targetDays: number | null;
  doneDay: DayKey | null;
  today: DayKey;
}): SlaStatus {
  const { startDay, targetDays, doneDay, today } = args;
  if (!startDay || !targetDays || targetDays <= 0) return { kind: "none", dueDay: null, margin: null };
  const dueDay = addBusinessDays(startDay, targetDays);
  if (doneDay) {
    const margin = businessDaysBetween(doneDay, dueDay);
    return { kind: doneDay <= dueDay ? "met" : "missed", dueDay, margin };
  }
  const margin = businessDaysBetween(today, dueDay);
  if (today > dueDay) return { kind: "overdue", dueDay, margin };
  return { kind: margin <= 1 ? "due_soon" : "pending", dueDay, margin };
}

export interface CourierSlaInput {
  received_at: string | null;
  created_at: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
}

export interface CourierSla {
  ack: SlaStatus;
  resolution: SlaStatus;
}

/**
 * Les deux échéances d'un courrier reçu. Une résolution vaut accusé de
 * réception : un courrier clos sans réponse (classé sans suite, doublon) n'est
 * pas compté en retard d'accusé au-delà du jour où il a été clos.
 */
export function courierSla(
  courier: CourierSlaInput,
  targets: SlaTargets,
  now: Date = new Date(),
): CourierSla {
  const startDay = parisDay(courier.received_at ?? courier.created_at);
  const today = parisDay(now)!;
  const resolvedDay = parisDay(courier.resolved_at);
  const ackedDay = parisDay(courier.acknowledged_at);
  const ackDoneDay =
    ackedDay && resolvedDay ? (ackedDay < resolvedDay ? ackedDay : resolvedDay) : (ackedDay ?? resolvedDay);
  return {
    ack: slaStatus({ startDay, targetDays: targets.ackDays, doneDay: ackDoneDay, today }),
    resolution: slaStatus({ startDay, targetDays: targets.resolutionDays, doneDay: resolvedDay, today }),
  };
}

/**
 * L'échéance qui compte pour une ligne de liste : l'accusé tant qu'il reste à
 * faire, puis la résolution. Un accusé en retard reste affiché tant qu'il n'est
 * pas fait — c'est l'urgence du moment.
 */
export function primarySla(sla: CourierSla): { axis: "ack" | "resolution"; status: SlaStatus } | null {
  const ackOpen = sla.ack.kind === "pending" || sla.ack.kind === "due_soon" || sla.ack.kind === "overdue";
  if (ackOpen) return { axis: "ack", status: sla.ack };
  if (sla.resolution.kind !== "none") return { axis: "resolution", status: sla.resolution };
  if (sla.ack.kind !== "none") return { axis: "ack", status: sla.ack };
  return null;
}

// ─── Libellés ───────────────────────────────────────────────────────────────

export const SLA_AXIS_LABELS = {
  ack: "Accusé de réception",
  resolution: "Résolution",
} as const;

function businessDays(n: number): string {
  return `${n} ${n > 1 ? "jours ouvrés" : "jour ouvré"}`;
}

export function formatDay(day: DayKey): string {
  const [y, m, d] = day.split("-");
  return `${d}/${m}/${y}`;
}

/** Libellé court d'un statut : « Retard 3 j ouvrés », « Avant le 12/10/2026 »… */
export function slaLabel(status: SlaStatus, today: DayKey): string {
  const { kind, dueDay, margin } = status;
  if (kind === "none" || !dueDay) return "Sans objectif";
  switch (kind) {
    case "met":
      return "Dans les délais";
    case "missed":
      return `Hors délai (${businessDays(Math.abs(margin ?? 0))})`;
    case "overdue":
      return `En retard de ${businessDays(Math.abs(margin ?? 0) || 1)}`;
    case "due_soon":
      return dueDay === today ? "Échéance aujourd'hui" : `Échéance le ${formatDay(dueDay)}`;
    case "pending":
      return `Échéance le ${formatDay(dueDay)}`;
  }
}
