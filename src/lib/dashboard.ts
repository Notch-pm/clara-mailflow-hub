/**
 * Tableau de bord (page d'accueil) : ce qui attend l'utilisateur, selon ses
 * casquettes — agent d'un service (instruction), service courrier, parapheur.
 *
 * Une même personne peut en cumuler plusieurs : les cartes « À faire » sont
 * alors fusionnées (plus urgentes d'abord, chacune marquée de sa provenance)
 * et la liste passe en onglets.
 *
 * Logique pure, sans React ni Supabase : testée dans `src/test/lib/dashboard.test.ts`.
 * Les courriers viennent du RPC `mailroom_couriers` (ouvert à tout membre),
 * classés par `classifyCourier` — la même lecture que l'écran « Courrier entrant ».
 */
import {
  batchCandidates,
  CONFIDENCE_BATCH_MIN,
  needsRouting,
  type MailroomItem,
  type MailroomView,
} from "@/lib/mailroom";
import { businessDaysBetween, parisDay, type DayKey, type SlaStatus } from "@/lib/courier-sla";
import { LATE_AFTER_DAYS, shortWaitLabel } from "@/lib/parapheur";

// ─── Casquettes ─────────────────────────────────────────────────────────────

export type DashboardRole = "instruction" | "mailroom" | "parapheur";

/** Ordre d'affichage des onglets, et d'arbitrage à urgence égale. */
export const DASHBOARD_ROLES: DashboardRole[] = ["mailroom", "instruction", "parapheur"];

/** Pastille de provenance d'une carte, quand plusieurs casquettes se cumulent. */
export const ROLE_SOURCE_LABELS: Record<DashboardRole, string> = {
  instruction: "Mon service",
  mailroom: "Courrier entrant",
  parapheur: "Parapheur",
};

/**
 * Les casquettes de l'utilisateur. Sans aucune (administrateur hors service,
 * gestionnaire non rattaché), la vue « instruction » à l'échelle de
 * l'organisation : l'accueil n'est jamais vide de sens.
 */
export function dashboardRoles(args: {
  memberOfServices: boolean;
  isServiceCourrier: boolean;
  canAccessParapheur: boolean;
}): DashboardRole[] {
  const roles = DASHBOARD_ROLES.filter((role) => {
    if (role === "instruction") return args.memberOfServices;
    if (role === "mailroom") return args.isServiceCourrier;
    return args.canAccessParapheur;
  });
  return roles.length ? roles : ["instruction"];
}

// ─── Cartes « À faire » ─────────────────────────────────────────────────────

/** Urgence d'une carte ou d'une pastille : rouge, jaune, neutre — ou vert (fiabilité). */
export type Tone = "urgent" | "attention" | "neutral" | "good";

const TONE_RANK: Record<Tone, number> = { urgent: 0, attention: 1, neutral: 2, good: 3 };

export interface TodoCard {
  key: string;
  role: DashboardRole;
  tone: Tone;
  label: string;
  count: number;
  sub: string;
  cta: string;
  href: string;
}

/** Plus urgentes d'abord, puis les plus fournies. Les cartes vides sont retirées. */
export function sortTodo(cards: TodoCard[]): TodoCard[] {
  return cards
    .filter((c) => c.count > 0)
    .sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone] || b.count - a.count);
}

function isOpen(item: MailroomItem): boolean {
  return !item.row.resolved_at;
}

function isOverdue(item: MailroomItem): boolean {
  return item.primary?.status.kind === "overdue";
}

/**
 * Courriers d'un périmètre de services. `null` : toute l'organisation. Un
 * courrier sans organisation n'est à personne ici — c'est au service courrier
 * de le router, pas à un service de le revendiquer.
 */
export function inScope(item: MailroomItem, scope: ReadonlySet<string> | null): boolean {
  if (!scope) return true;
  return !!item.row.socle_organization_id && scope.has(item.row.socle_organization_id);
}

/** Arrivé dans le service, pas encore pris en charge (ce que montre la boîte aux lettres). */
function awaitsPickup(item: MailroomItem): boolean {
  const { row } = item;
  return !row.taken_at && (!row.workflow_state_id || row.state_is_initial);
}

/**
 * Retards d'un service : les courriers qu'on lui a confiés (routés ou pris en
 * charge). Un courrier encore à router est en retard chez le service courrier,
 * pas chez lui — sauf si la collectivité n'a pas de service courrier : personne
 * d'autre ne le verrait alors.
 */
export function instructionTodo(
  items: MailroomItem[],
  scope: ReadonlySet<string> | null,
  draftCount: number,
  mailroomActive: boolean,
): TodoCard[] {
  const mine = items.filter((i) => isOpen(i) && inScope(i, scope));
  const lateOfService = (i: MailroomItem) => isOverdue(i) && (!mailroomActive || !needsRouting(i.row));
  const card = (c: Omit<TodoCard, "role">): TodoCard => ({ ...c, role: "instruction" });
  return [
    card({
      key: "instruction-late",
      tone: "urgent",
      label: "En retard",
      count: mine.filter(lateOfService).length,
      sub: "échéance dépassée",
      cta: "Traiter",
      href: "/courriers-en-instruction",
    }),
    card({
      key: "instruction-pickup",
      tone: "attention",
      label: "À prendre en charge",
      count: mine.filter(awaitsPickup).length,
      sub: scope ? "arrivés dans votre service" : "arrivés dans l'organisation",
      cta: "Voir",
      href: "/boite-aux-lettres",
    }),
    card({
      key: "instruction-reminded",
      tone: "attention",
      label: "Relancés",
      count: mine.filter((i) => i.row.reminder_count > 0).length,
      sub: "par le service courrier",
      cta: "Voir",
      href: "/courriers-en-instruction",
    }),
    card({
      key: "instruction-drafts",
      tone: "neutral",
      label: "Réponses en rédaction",
      count: draftCount,
      sub: "brouillons à finir",
      cta: "Reprendre",
      href: "/courriers-sortants",
    }),
  ];
}

export function mailroomHref(view: MailroomView): string {
  return `/courrier-entrant?vue=${view}`;
}

export function mailroomTodo(items: MailroomItem[]): TodoCard[] {
  const count = (stage: MailroomItem["stage"]) => items.filter((i) => i.stage === stage).length;
  const card = (c: Omit<TodoCard, "role">): TodoCard => ({ ...c, role: "mailroom" });
  return [
    card({
      key: "mailroom-validate",
      tone: "attention",
      label: "À valider",
      count: count("to_validate"),
      sub: "proposition de Clara",
      cta: "Valider",
      href: mailroomHref("av"),
    }),
    card({
      key: "mailroom-qualify",
      tone: "attention",
      label: "À qualifier",
      count: count("to_qualify"),
      sub: "proposition incertaine",
      cta: "Qualifier",
      href: mailroomHref("aq"),
    }),
    card({
      key: "mailroom-reorient",
      tone: "urgent",
      label: "À réorienter",
      count: count("to_reorient"),
      sub: "renvoyés par un service",
      cta: "Réorienter",
      href: mailroomHref("retour"),
    }),
    card({
      key: "mailroom-late",
      tone: "urgent",
      label: "En retard",
      count: count("late"),
      sub: "routés, échéance dépassée",
      cta: "Relancer",
      href: mailroomHref("retard"),
    }),
  ];
}

/** Une réponse en attente dans le parapheur, visa ou signature. */
export interface ParapheurEntry {
  kind: "visa" | "signature";
  replyId: string;
  parentCourierId: string | null;
  title: string;
  chrono: string | null;
  senderName: string | null;
  /** Étape de visa (« Visa du DGS ») ; « À signer » pour une signature. */
  step: string;
  waitingDays: number;
}

/** « dont 1 depuis 6 j » : ce qui traîne, sinon simplement ce qui attend. */
export function waitingSub(entries: ParapheurEntry[]): string {
  const late = entries.filter((e) => e.waitingDays >= LATE_AFTER_DAYS);
  if (late.length === 1) return `dont 1 depuis ${late[0].waitingDays} j`;
  if (late.length > 1) return `dont ${late.length} depuis ${LATE_AFTER_DAYS} j ou plus`;
  return entries.length > 1 ? "réponses en attente" : "réponse en attente";
}

export function parapheurTodo(entries: ParapheurEntry[], orgLateCount: number | null): TodoCard[] {
  const visa = entries.filter((e) => e.kind === "visa");
  const signature = entries.filter((e) => e.kind === "signature");
  const card = (c: Omit<TodoCard, "role">): TodoCard => ({ ...c, role: "parapheur" });
  const cards = [
    card({
      key: "parapheur-visa",
      tone: "attention",
      label: "À viser",
      count: visa.length,
      sub: waitingSub(visa),
      cta: "Ouvrir le parapheur",
      href: "/parapheur?onglet=visa",
    }),
    card({
      key: "parapheur-signature",
      tone: "attention",
      label: "À signer",
      count: signature.length,
      sub: waitingSub(signature),
      cta: "Ouvrir le parapheur",
      href: "/parapheur?onglet=signature",
    }),
  ];
  // Un viseur administrateur (DGS) suit aussi les retards de toute l'organisation.
  if (orgLateCount !== null) {
    cards.push(
      card({
        key: "parapheur-org-late",
        tone: "urgent",
        label: "En retard dans l'organisation",
        count: orgLateCount,
        sub: "tous services",
        cta: "Voir",
        href: "/courriers-en-instruction",
      }),
    );
  }
  return cards;
}

/** Courriers ouverts en retard, tous services confondus. */
export function orgLateCount(items: MailroomItem[]): number {
  return items.filter((i) => isOpen(i) && isOverdue(i)).length;
}

// ─── Action principale ──────────────────────────────────────────────────────

export interface HeroAction {
  label: string;
  href: string;
}

/**
 * Le bouton en haut à droite : le geste qui libère le plus de travail.
 * Les retards d'un agent ne s'y affichent que s'il porte plusieurs casquettes
 * (seul, ses cartes suffisent) ; la validation en lot du service courrier, si
 * des propositions sont assez sûres pour être validées d'un coup.
 */
export function heroAction(args: {
  roles: DashboardRole[];
  instructionLate: number;
  mailroomItems: MailroomItem[];
}): HeroAction | null {
  const { roles, instructionLate } = args;
  if (roles.length > 1 && roles.includes("instruction") && instructionLate > 0) {
    return {
      label: `Traiter ${instructionLate > 1 ? `mes ${instructionLate} courriers` : "mon courrier"} en retard`,
      href: "/courriers-en-instruction",
    };
  }
  if (roles.includes("mailroom")) {
    const batch = batchCandidates(args.mailroomItems).length;
    if (batch > 0) {
      return {
        label:
          batch > 1
            ? `Valider les ${batch} propositions ≥ ${CONFIDENCE_BATCH_MIN} %`
            : `Valider la proposition ≥ ${CONFIDENCE_BATCH_MIN} %`,
        href: mailroomHref("av"),
      };
    }
  }
  return null;
}

// ─── Listes ─────────────────────────────────────────────────────────────────

export interface ListRow {
  id: string;
  href: string;
  title: string;
  chrono: string | null;
  sender: string | null;
  mid: string;
  end: string;
  tone: Tone;
}

export interface DashboardList {
  role: DashboardRole;
  /** Titre seul, ou libellé d'onglet. */
  title: string;
  tabLabel: string;
  count: number;
  link: { label: string; href: string };
  columns: [string, string];
  rows: ListRow[];
  /** Lignes en rouge : choisit l'onglet ouvert d'office. */
  urgentCount: number;
}

export const LIST_SIZE = 5;

const SHORT_MONTH = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" });

/** « 3 oct. » */
export function shortDay(day: DayKey): string {
  return SHORT_MONTH.format(new Date(`${day}T12:00:00Z`));
}

/** La pastille d'échéance d'un courrier en instruction. */
export function deadlinePill(status: SlaStatus | undefined, today: DayKey): { end: string; tone: Tone } {
  if (!status?.dueDay || status.kind === "none") return { end: "Sans échéance", tone: "neutral" };
  if (status.kind === "overdue") {
    const days = Math.max(1, businessDaysBetween(status.dueDay, today));
    return { end: `Dépassée de ${days} j`, tone: "urgent" };
  }
  if (status.kind === "due_soon") {
    return { end: status.dueDay === today ? "Aujourd'hui" : shortDay(status.dueDay), tone: "attention" };
  }
  return { end: shortDay(status.dueDay), tone: "neutral" };
}

/** Échéance la plus pressante d'abord ; sans échéance en dernier. */
function dueRank(item: MailroomItem): string {
  return item.primary?.status.dueDay ?? "9999-12-31";
}

export function instructionList(
  items: MailroomItem[],
  scope: ReadonlySet<string> | null,
  stateName: (id: string | null) => string | null,
  now: Date = new Date(),
): DashboardList {
  const today = parisDay(now)!;
  const mine = items
    .filter((i) => isOpen(i) && inScope(i, scope) && i.row.state_category === "processing")
    .sort((a, b) => dueRank(a).localeCompare(dueRank(b)));
  const rows = mine.map<ListRow>((i) => ({
    id: i.row.id,
    href: `/courrier/${i.row.id}`,
    title: i.row.subject ?? "(sans objet)",
    chrono: i.row.chrono,
    sender: i.row.sender_name,
    mid: stateName(i.row.workflow_state_id) ?? "—",
    ...deadlinePill(i.primary?.status, today),
  }));
  return {
    role: "instruction",
    // Les courriers du service (ou de l'organisation), pas ceux d'une personne :
    // Clara n'attribue un courrier qu'à une organisation.
    title: "À traiter",
    tabLabel: "À traiter",
    count: rows.length,
    link: { label: "Tous les courriers en instruction", href: "/courriers-en-instruction" },
    columns: ["Étape", "Échéance"],
    rows: rows.slice(0, LIST_SIZE),
    urgentCount: rows.filter((r) => r.tone === "urgent").length,
  };
}

export function mailroomList(items: MailroomItem[], orgName: (id: string | null) => string | null): DashboardList {
  const toValidate = items
    .filter((i) => i.stage === "to_validate")
    .sort((a, b) => (b.row.suggested_service_confidence ?? -1) - (a.row.suggested_service_confidence ?? -1));
  const rows = toValidate.map<ListRow>((i) => {
    const confidence = i.row.suggested_service_confidence;
    return {
      id: i.row.id,
      href: `/courrier/${i.row.id}`,
      title: i.row.subject ?? "(sans objet)",
      chrono: i.row.chrono,
      sender: i.row.sender_name,
      mid: orgName(i.row.suggested_socle_organization_id) ?? "—",
      end: confidence === null ? "—" : `${confidence} %`,
      tone: confidence !== null && confidence >= CONFIDENCE_BATCH_MIN ? "good" : "attention",
    };
  });
  return {
    role: "mailroom",
    title: "À valider",
    tabLabel: "À valider",
    count: rows.length,
    link: { label: "Ouvrir le courrier entrant", href: mailroomHref("av") },
    columns: ["Service proposé", "Confiance"],
    rows: rows.slice(0, LIST_SIZE),
    // Les à-réorienter et les retards sont rouges dans les cartes, pas dans cette liste.
    urgentCount: items.filter((i) => i.stage === "to_reorient" || i.stage === "late").length,
  };
}

/** Lien vers la réponse dans l'espace de travail du courrier reçu. */
export function replyHref(entry: Pick<ParapheurEntry, "replyId" | "parentCourierId">): string {
  return entry.parentCourierId
    ? `/courrier/${entry.parentCourierId}?tab=response&replyId=${entry.replyId}&edit=1`
    : `/courrier/${entry.replyId}`;
}

export function parapheurList(entries: ParapheurEntry[]): DashboardList {
  const sorted = [...entries].sort((a, b) => b.waitingDays - a.waitingDays);
  const rows = sorted.map<ListRow>((e) => ({
    id: e.replyId,
    href: replyHref(e),
    title: e.title,
    chrono: e.chrono,
    sender: e.senderName,
    mid: e.step,
    end: shortWaitLabel(e.waitingDays),
    tone: e.waitingDays >= LATE_AFTER_DAYS ? "attention" : "neutral",
  }));
  return {
    role: "parapheur",
    title: "Dans votre parapheur",
    tabLabel: "Parapheur",
    count: rows.length,
    link: { label: "Ouvrir le parapheur", href: "/parapheur" },
    columns: ["Étape", "Attente"],
    rows: rows.slice(0, LIST_SIZE),
    urgentCount: rows.filter((r) => r.tone === "attention").length,
  };
}

/** L'onglet ouvert d'office : celui qui a le plus de lignes urgentes. */
export function defaultListRole(lists: DashboardList[]): DashboardRole | null {
  if (!lists.length) return null;
  return [...lists].sort(
    (a, b) => b.urgentCount - a.urgentCount || DASHBOARD_ROLES.indexOf(a.role) - DASHBOARD_ROLES.indexOf(b.role),
  )[0].role;
}

// ─── Tendances des douze derniers mois ──────────────────────────────────────

/** Une ligne du RPC `dashboard_trends` : un mois complet, heure de Paris. */
export interface TrendRow {
  month: string;
  received: number;
  open_at_end: number;
  answered: number;
  avg_days_to_answer: number | null;
  resolved: number;
  avg_days_to_resolve: number | null;
}

export interface TrendPoint {
  /** « septembre 2026 » */
  label: string;
  /** « sept. 2026 », au survol. */
  short: string;
  value: number | null;
  /** « 148 » / « 10,6 » — « — » sans valeur. */
  display: string;
}

export interface TrendChart {
  key: string;
  label: string;
  unit: string;
  points: TrendPoint[];
  /** Écart du dernier mois avec le précédent ; `null` si l'un manque. */
  delta: string | null;
  /** `null` : l'écart n'est ni bon ni mauvais (volume reçu). */
  trend: "good" | "bad" | null;
}

const frNumber = new Intl.NumberFormat("fr-FR");
const frDays = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const MONTH_FORMAT = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });
const MONTH_SHORT = new Intl.DateTimeFormat("fr-FR", { month: "short", year: "numeric", timeZone: "UTC" });
const MONTH_ONLY = new Intl.DateTimeFormat("fr-FR", { month: "long", timeZone: "UTC" });

function monthDate(month: string): Date {
  return new Date(`${month}-15T12:00:00Z`);
}

/** « septembre » pour la légende « valeur de septembre, écart avec août ». */
export function monthName(month: string): string {
  return MONTH_ONLY.format(monthDate(month));
}

const sign = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "");

interface Metric {
  key: string;
  label: string;
  unit: string;
  pick: (r: TrendRow) => number | null;
  days?: boolean;
  /** Sens souhaitable : `null` pour un volume qui ne se juge pas. */
  better: "up" | "down" | null;
}

const METRICS: Metric[] = [
  { key: "received", label: "Courriers reçus", unit: "courriers", pick: (r) => r.received, better: null },
  { key: "open", label: "En cours", unit: "en fin de mois", pick: (r) => r.open_at_end, better: "down" },
  { key: "answered", label: "Courriers répondus", unit: "courriers", pick: (r) => r.answered, better: "up" },
  {
    key: "answer-delay",
    label: "Délai moyen de réponse",
    unit: "jours",
    pick: (r) => r.avg_days_to_answer,
    days: true,
    better: "down",
  },
  {
    key: "resolve-delay",
    label: "Délai moyen de traitement",
    unit: "jours",
    pick: (r) => r.avg_days_to_resolve,
    days: true,
    better: "down",
  },
];

function deltaOf(metric: Metric, cur: number | null, prev: number | null): { delta: string | null; diff: number } {
  if (cur === null || prev === null) return { delta: null, diff: 0 };
  const diff = cur - prev;
  if (metric.days) {
    // Arrondi au dixième avant de juger : « +0,0 j » n'est pas une hausse.
    const tenth = Math.round(diff * 10) / 10;
    return { delta: `${sign(tenth)}${frDays.format(Math.abs(tenth))} j`, diff: tenth };
  }
  if (prev === 0) return { delta: null, diff };
  const pct = Math.round((diff / prev) * 100);
  return { delta: `${sign(pct)}${Math.abs(pct)} %`, diff: pct };
}

/**
 * Les cinq courbes de l'accueil, du plus ancien mois au plus récent. La valeur
 * affichée est celle du dernier mois complet, comparée au mois d'avant.
 */
export function trendCharts(rows: TrendRow[]): TrendChart[] {
  const sorted = [...rows].sort((a, b) => a.month.localeCompare(b.month));
  return METRICS.map((metric) => {
    const points = sorted.map<TrendPoint>((r) => {
      const value = metric.pick(r);
      return {
        label: MONTH_FORMAT.format(monthDate(r.month)),
        short: MONTH_SHORT.format(monthDate(r.month)),
        value,
        display: value === null ? "—" : metric.days ? frDays.format(value) : frNumber.format(value),
      };
    });
    const n = points.length;
    const { delta, diff } = deltaOf(metric, points[n - 1]?.value ?? null, points[n - 2]?.value ?? null);
    const trend =
      metric.better === null || diff === 0 || delta === null
        ? null
        : (diff > 0) === (metric.better === "up")
          ? "good"
          : "bad";
    return { key: metric.key, label: metric.label, unit: metric.unit, points, delta, trend };
  });
}

/**
 * Tracé d'une courbe dans un repère 100 × 32 (étiré par le SVG). Un mois sans
 * valeur coupe la ligne plutôt que de la faire plonger à zéro.
 */
export function sparklinePaths(values: (number | null)[]): {
  line: string;
  area: string;
  y: (number | null)[];
} {
  const known = values.filter((v): v is number => v !== null);
  const n = values.length;
  if (!known.length || n === 0) return { line: "", area: "", y: values.map(() => null) };
  const min = Math.min(...known);
  const range = Math.max(...known) - min;
  const x = (i: number) => (n === 1 ? 50 : (i / (n - 1)) * 100);
  // Une série plate tient au milieu, pas collée en bas.
  const y = values.map((v) => (v === null ? null : range ? 29 - ((v - min) / range) * 26 : 16));

  let line = "";
  let area = "";
  let run: number[] = [];
  const flush = () => {
    if (!run.length) return;
    const seg = run.map((i, k) => `${k ? "L" : "M"}${x(i).toFixed(2)} ${y[i]!.toFixed(2)}`).join(" ");
    line += (line ? " " : "") + seg;
    area += `${area ? " " : ""}${seg} L${x(run[run.length - 1]).toFixed(2)} 32 L${x(run[0]).toFixed(2)} 32 Z`;
    run = [];
  };
  values.forEach((v, i) => (v === null ? flush() : run.push(i)));
  flush();
  return { line, area, y };
}

// ─── En-tête ────────────────────────────────────────────────────────────────

const LONG_DAY = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Europe/Paris",
});

/** « Jeudi 1er octobre 2026 » */
export function longDate(now: Date = new Date()): string {
  const text = LONG_DAY.format(now).replace(/^(\S+) 1 /, "$1 1er ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** « Services techniques · service courrier · parapheur » */
export function scopeLabel(roles: DashboardRole[], serviceNames: string[], fallback: string | null): string {
  const parts = [
    ...(roles.includes("instruction") ? serviceNames : []),
    ...(roles.includes("mailroom") ? ["service courrier"] : []),
    ...(roles.includes("parapheur") ? ["parapheur"] : []),
  ];
  if (!parts.length) return fallback ?? "";
  const text = parts.join(" · ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

