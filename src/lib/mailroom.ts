/**
 * Écran « Courrier entrant » du gestionnaire courrier : classement des courriers
 * reçus en étapes, à partir des lignes du RPC `mailroom_couriers`.
 *
 * Le service courrier QUALIFIE (accepte ou corrige la proposition de l'IA),
 * ROUTE vers le service gestionnaire, puis SUIT et RELANCE. D'où deux familles
 * d'étapes :
 * - à router : `analysing`, `to_qualify`, `to_validate`, `to_reorient` ;
 * - routé : `routed`, `late`, `done`.
 *
 * « À router » ne veut pas dire « sans organisation » : la plupart des courriers
 * arrivent DÉJÀ rattachés à l'organisation de leur boîte IMAP, à l'état initial.
 * Tant que personne ne les a routés (aucun événement de routage) ni pris en
 * charge, ils restent à router — le service courrier confirme ou corrige.
 *
 * Logique pure, sans React ni Supabase : testée dans `src/test/lib/mailroom.test.ts`.
 */
import type { MailroomRow } from "@/services/mailroomService";
import {
  businessDaysBetween,
  courierSla,
  parisDay,
  primarySla,
  type CourierSla,
  type SlaOrgNode,
  type SlaStatus,
  resolveSlaTargets,
} from "@/lib/courier-sla";

export type MailroomStage =
  | "analysing"
  | "to_qualify"
  | "to_validate"
  | "to_reorient"
  | "routed"
  | "late"
  | "done";

export type QualifyReason =
  | "analysis_failed"
  | "not_analysed"
  | "no_suggestion"
  | "unavailable"
  | "uncertain";

/** En dessous, la proposition de l'IA ne suffit pas : le courrier est « à qualifier ». */
export const CONFIDENCE_VALIDATE_MIN = 70;
/** À partir de là, la proposition peut être validée en lot. */
export const CONFIDENCE_BATCH_MIN = 90;

export const QUALIFY_REASONS: Record<QualifyReason, { title: string; text: string }> = {
  analysis_failed: {
    title: "Échec d'analyse",
    text: "Clara n'a pas pu lire ce courrier. Vérifiez l'expéditeur et l'objet à partir du document, puis choisissez le service.",
  },
  not_analysed: {
    title: "Non analysé",
    text: "Ce courrier n'a pas encore fait l'objet d'une analyse IA, lancez l'analyse ou assignez manuellement un service gestionnaire.",
  },
  no_suggestion: {
    title: "Service non identifié",
    text: "Aucune organisation ne s'impose d'après le contenu du courrier.",
  },
  unavailable: {
    title: "Service proposé indisponible",
    text: "L'organisation proposée n'est plus active ou n'a pas de circuit de traitement. Choisissez-en une autre.",
  },
  uncertain: {
    title: "Service incertain",
    text: "Plusieurs services sont possibles, ou le courrier mêle plusieurs demandes. Choisissez le service principal.",
  },
};

export interface MailroomContext {
  /** Organisations proposables au routage (actives). */
  assignableIds: ReadonlySet<string>;
  /** Organisations du miroir, pour les objectifs de délai (héritage parent). */
  orgs: readonly SlaOrgNode[];
  now?: Date;
}

export interface MailroomItem {
  row: MailroomRow;
  stage: MailroomStage;
  /** Raison du blocage, pour `to_qualify`. */
  reason: QualifyReason | null;
  /** Échéances du courrier (objectifs de l'organisation, ou de la racine si aucune). */
  sla: CourierSla;
  /** L'échéance du moment (accusé, puis résolution). */
  primary: { axis: "ack" | "resolution"; status: SlaStatus } | null;
}

/** Le service courrier doit encore décider à qui confier ce courrier. */
export function needsRouting(row: MailroomRow): boolean {
  if (row.resolved_at) return false;
  if (!row.socle_organization_id || row.returned_at) return true;
  return !row.routed_at && !row.taken_at && (!row.workflow_state_id || row.state_is_initial);
}

/** Pourquoi la proposition de l'IA ne suffit pas — `null` si elle est exploitable. */
export function qualifyReason(row: MailroomRow, assignableIds: ReadonlySet<string>): QualifyReason | null {
  if (!row.has_analysis) return row.analysis_status === "failed" ? "analysis_failed" : "not_analysed";
  const suggested = row.suggested_socle_organization_id;
  if (!suggested) return "no_suggestion";
  if (!assignableIds.has(suggested)) return "unavailable";
  if (row.suggested_service_confidence !== null && row.suggested_service_confidence < CONFIDENCE_VALIDATE_MIN) {
    return "uncertain";
  }
  return null;
}

export function classifyCourier(row: MailroomRow, ctx: MailroomContext): MailroomItem {
  const now = ctx.now ?? new Date();
  const sla = courierSla(row, resolveSlaTargets(ctx.orgs, row.socle_organization_id), now);
  const primary = primarySla(sla);
  const item = (stage: MailroomStage, reason: QualifyReason | null = null): MailroomItem => ({
    row,
    stage,
    reason,
    sla,
    primary,
  });

  if (row.resolved_at) return item("done");
  if (needsRouting(row)) {
    if (row.returned_at) return item("to_reorient");
    if (row.analysis_status === "pending" || row.analysis_status === "running") return item("analysing");
    const reason = qualifyReason(row, ctx.assignableIds);
    return reason ? item("to_qualify", reason) : item("to_validate");
  }
  return primary?.status.kind === "overdue" ? item("late") : item("routed");
}

// ─── Vues (onglets) ─────────────────────────────────────────────────────────

/**
 * Pas d'onglet « En retard » : un retard se lit DANS chaque liste (pastille de
 * la ligne, compteur de l'onglet) et se filtre (`lateOnly`). Un courrier routé
 * en retard reste ainsi « En cours » : il ne change pas d'onglet en dépassant
 * son échéance.
 */
export type MailroomView = "aq" | "av" | "retour" | "cours" | "traites" | "tous";

export interface MailroomViewDef {
  label: string;
  description: string;
  sortLabel: string;
  empty: string;
  /** Libellés des deux colonnes à droite de « Courrier ». */
  columns: [string, string];
  stages: MailroomStage[] | null;
}

export const MAILROOM_VIEWS: Record<MailroomView, MailroomViewDef> = {
  aq: {
    label: "À qualifier",
    description: "Intervention requise avant routage",
    sortLabel: "Plus anciens d'abord",
    empty: "Aucun courrier à qualifier.",
    columns: ["Service pressenti", "Ce qui bloque"],
    stages: ["to_qualify"],
  },
  av: {
    label: "À valider",
    description: "Propositions de Clara à contrôler",
    sortLabel: "Plus anciens d'abord",
    empty: "Aucune proposition à valider.",
    columns: ["Service proposé", "Fiabilité"],
    stages: ["to_validate"],
  },
  retour: {
    label: "À réorienter",
    description: "Renvoyés par un service, travail restant à confier",
    sortLabel: "Plus récents d'abord",
    empty: "Aucun courrier à réorienter.",
    columns: ["Renvoyé par", "Action"],
    stages: ["to_reorient"],
  },
  cours: {
    label: "En cours",
    description: "Routés, non clôturés",
    sortLabel: "Échéance la plus proche",
    empty: "Aucun courrier en cours.",
    columns: ["Service destinataire", "Statut et échéance"],
    stages: ["routed", "late"],
  },
  traites: {
    label: "Traités",
    description: "Courriers clôturés sur la période",
    sortLabel: "Plus récents d'abord",
    empty: "Aucun courrier traité sur la période.",
    columns: ["Service destinataire", "Clôture"],
    stages: ["done"],
  },
  tous: {
    label: "Tous",
    description: "Circulation complète du courrier",
    sortLabel: "Plus récents d'abord",
    empty: "Aucun courrier.",
    columns: ["Service", "Statut"],
    stages: null,
  },
};

export const MAILROOM_VIEW_ORDER: MailroomView[] = ["aq", "av", "retour", "cours", "traites", "tous"];

export function inView(item: MailroomItem, view: MailroomView): boolean {
  const stages = MAILROOM_VIEWS[view].stages;
  return stages === null || stages.includes(item.stage);
}

/** Onglet où se range une étape — `null` pendant l'analyse (« Tous » seulement). */
export function viewOfStage(stage: MailroomStage): Exclude<MailroomView, "tous"> | null {
  switch (stage) {
    case "analysing":
      return null;
    case "to_qualify":
      return "aq";
    case "to_validate":
      return "av";
    case "to_reorient":
      return "retour";
    case "routed":
    case "late":
      return "cours";
    case "done":
      return "traites";
  }
}

/**
 * Échéance du moment dépassée, courrier non clôturé — à router compris : un
 * accusé de réception peut déjà être en retard chez le service courrier.
 */
export function isLate(item: MailroomItem): boolean {
  return !item.row.resolved_at && item.primary?.status.kind === "overdue";
}

const time = (value: string | null | undefined) => (value ? new Date(value).getTime() : 0);
const receivedTime = (item: MailroomItem) => time(item.row.received_at ?? item.row.created_at);

/** Ordre de la liste : celui de la vue (`sortLabel`), ou un ordre choisi. */
export type MailroomSort = "default" | "recent" | "oldest" | "due";

export const MAILROOM_SORTS: { value: Exclude<MailroomSort, "default">; label: string }[] = [
  { value: "recent", label: "Plus récents d'abord" },
  { value: "oldest", label: "Plus anciens d'abord" },
  { value: "due", label: "Échéance la plus proche" },
];

const byDue = (a: MailroomItem, b: MailroomItem) => {
  const da = a.primary?.status.dueDay ?? "9999-12-31";
  const db = b.primary?.status.dueDay ?? "9999-12-31";
  return da < db ? -1 : da > db ? 1 : receivedTime(a) - receivedTime(b);
};

export function sortItems(items: MailroomItem[], view: MailroomView, sort: MailroomSort): MailroomItem[] {
  switch (sort) {
    case "default":
      return sortForView(items, view);
    case "recent":
      return [...items].sort((a, b) => receivedTime(b) - receivedTime(a));
    case "oldest":
      return [...items].sort((a, b) => receivedTime(a) - receivedTime(b));
    case "due":
      return [...items].sort(byDue);
  }
}

/** Tri propre à chaque vue (voir `sortLabel`). */
export function sortForView(items: MailroomItem[], view: MailroomView): MailroomItem[] {
  const list = [...items];
  switch (view) {
    case "aq":
    case "av":
      return list.sort((a, b) => receivedTime(a) - receivedTime(b));
    case "retour":
      return list.sort((a, b) => time(b.row.returned_at) - time(a.row.returned_at));
    // Échéance la plus proche : les retards, échéance passée, en tête.
    case "cours":
      return list.sort(byDue);
    case "traites":
      return list.sort((a, b) => time(b.row.resolved_at) - time(a.row.resolved_at));
    case "tous":
      return list.sort((a, b) => receivedTime(b) - receivedTime(a));
  }
}

export interface MailroomCounts {
  aq: number;
  av: number;
  retour: number;
  cours: number;
  traites: number;
  traitesToday: number;
  tous: number;
  analysing: number;
  /** Courriers en retard (`isLate`) de chaque onglet. */
  late: Record<MailroomView, number>;
}

export function countViews(items: MailroomItem[], now: Date = new Date()): MailroomCounts {
  const today = parisDay(now);
  const counts: MailroomCounts = {
    aq: 0,
    av: 0,
    retour: 0,
    cours: 0,
    traites: 0,
    traitesToday: 0,
    tous: items.length,
    analysing: 0,
    late: { aq: 0, av: 0, retour: 0, cours: 0, traites: 0, tous: 0 },
  };
  for (const item of items) {
    if (isLate(item)) {
      counts.late.tous++;
      const view = viewOfStage(item.stage);
      if (view) counts.late[view]++;
    }
    switch (item.stage) {
      case "analysing":
        counts.analysing++;
        break;
      case "to_qualify":
        counts.aq++;
        break;
      case "to_validate":
        counts.av++;
        break;
      case "to_reorient":
        counts.retour++;
        break;
      case "routed":
      case "late":
        counts.cours++;
        break;
      case "done":
        counts.traites++;
        if (parisDay(item.row.resolved_at) === today) counts.traitesToday++;
        break;
    }
  }
  return counts;
}

/** Propositions validables en lot : à valider, confiance connue et ≥ seuil. */
export function batchCandidates(items: MailroomItem[]): MailroomItem[] {
  return items.filter(
    (i) =>
      i.stage === "to_validate" &&
      i.row.suggested_service_confidence !== null &&
      i.row.suggested_service_confidence >= CONFIDENCE_BATCH_MIN,
  );
}

/**
 * Courriers à envoyer à l'analyse IA : à qualifier faute d'analyse (jamais
 * analysés, ou analyse en échec). Un courrier déjà en file est en « analysing ».
 */
export function analysisCandidates(items: MailroomItem[]): MailroomItem[] {
  return items.filter(
    (i) => i.stage === "to_qualify" && (i.reason === "not_analysed" || i.reason === "analysis_failed"),
  );
}

// ─── Recherche et filtres ───────────────────────────────────────────────────

export interface MailroomFilters {
  query: string;
  channels: string[];
  /** Organisation destinataire (ou proposée pour un courrier à router). */
  serviceId: string | null;
  /** Ne garder que les courriers en retard (`isLate`). */
  lateOnly?: boolean;
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

export function matchesFilters(item: MailroomItem, filters: MailroomFilters): boolean {
  const { row } = item;
  if (filters.lateOnly && !isLate(item)) return false;
  if (filters.channels.length && !filters.channels.includes(row.channel)) return false;
  if (filters.serviceId) {
    const routingTarget = needsRouting(row) ? row.suggested_socle_organization_id : row.socle_organization_id;
    if (routingTarget !== filters.serviceId && row.socle_organization_id !== filters.serviceId) return false;
  }
  const q = normalize(filters.query.trim());
  if (!q) return true;
  return normalize([row.sender_name, row.subject, row.chrono].filter(Boolean).join(" ")).includes(q);
}

// ─── Suivi ──────────────────────────────────────────────────────────────────

/**
 * Avancement vers l'échéance de résolution, de 0 à 100 (bornes comprises) —
 * `null` sans objectif. Un courrier en retard est à 100.
 */
export function slaProgress(item: MailroomItem, now: Date = new Date()): number | null {
  const status = item.sla.resolution;
  if (!status.dueDay) return null;
  const start = parisDay(item.row.received_at ?? item.row.created_at);
  const today = parisDay(now);
  if (!start || !today) return null;
  const total = businessDaysBetween(start, status.dueDay);
  if (total <= 0) return 100;
  const elapsed = businessDaysBetween(start, today);
  return Math.min(100, Math.max(0, Math.round((elapsed / total) * 100)));
}

export type TimelineKind = "done" | "warn" | "late" | "todo";

export interface TimelineStep {
  label: string;
  date: string | null;
  kind: TimelineKind;
}

/** Frise de suivi d'un courrier routé : reçu, routé, pris en charge, relances, réponse attendue. */
export function trackingTimeline(item: MailroomItem, channelLabel: string): TimelineStep[] {
  const { row } = item;
  const late = item.stage === "late";
  const steps: TimelineStep[] = [
    { label: `Reçu (${channelLabel.toLowerCase()})`, date: row.received_at ?? row.created_at, kind: "done" },
  ];
  if (row.routed_at) {
    steps.push({ label: `Routé vers ${row.assigned_service ?? "le service"}`, date: row.routed_at, kind: "done" });
  } else if (row.assigned_service) {
    steps.push({ label: `Confié à ${row.assigned_service}`, date: null, kind: "done" });
  }
  steps.push(
    row.taken_at || (row.workflow_state_id && !row.state_is_initial)
      ? { label: "Pris en charge par le service", date: row.taken_at, kind: "done" }
      : { label: "Prise en charge en attente", date: null, kind: late ? "late" : "todo" },
  );
  if (row.reminder_count > 0) {
    steps.push({
      label: row.reminder_count > 1 ? `${row.reminder_count} relances envoyées` : "Relance envoyée",
      date: row.last_reminder_at,
      kind: "warn",
    });
  }
  const due = item.sla.resolution.dueDay;
  steps.push({ label: "Réponse attendue", date: due, kind: late ? "late" : "todo" });
  return steps;
}

// ─── Déplacements (toasts après une action) ─────────────────────────────────

export interface MoveGroup {
  /** Onglet d'arrivée — `null` : encore en analyse. */
  view: Exclude<MailroomView, "tous"> | null;
  count: number;
  /** Dont en retard. */
  late: number;
}

/**
 * Où se sont rangés des courriers après une action : un groupe par onglet
 * d'arrivée, dans l'ordre des onglets (l'analyse en dernier). Un courrier
 * absent de la liste (sorti de la période) n'est compté nulle part.
 */
export function summarizeMoves(items: MailroomItem[], ids: readonly string[]): MoveGroup[] {
  const wanted = new Set(ids);
  const groups = new Map<MoveGroup["view"], MoveGroup>();
  for (const item of items) {
    if (!wanted.has(item.row.id)) continue;
    const view = viewOfStage(item.stage);
    const group = groups.get(view) ?? { view, count: 0, late: 0 };
    group.count++;
    if (isLate(item)) group.late++;
    groups.set(view, group);
  }
  const rank = (v: MoveGroup["view"]) => (v === null ? MAILROOM_VIEW_ORDER.length : MAILROOM_VIEW_ORDER.indexOf(v));
  return [...groups.values()].sort((a, b) => rank(a.view) - rank(b.view));
}

/** « « En cours » : 10 (dont 2 en retard) · « À qualifier » : 1 » */
export function describeMoveGroups(groups: MoveGroup[]): string {
  return groups
    .map((g) => {
      const where = g.view ? `« ${MAILROOM_VIEWS[g.view].label} »` : "En cours d'analyse";
      return `${where} : ${g.count}${g.late ? ` (dont ${g.late} en retard)` : ""}`;
    })
    .join(" · ");
}
