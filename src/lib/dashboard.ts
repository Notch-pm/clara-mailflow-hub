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
  type MailroomItem,
  type MailroomView,
} from "@/lib/mailroom";
import { businessDaysBetween, parisDay, type DayKey, type SlaStatus } from "@/lib/courier-sla";
import { LATE_AFTER_DAYS, shortWaitLabel } from "@/lib/parapheur";

// ─── Casquettes ─────────────────────────────────────────────────────────────

export type DashboardRole = "instruction" | "mailroom" | "parapheur";

/** Ordre d'affichage des onglets, et d'arbitrage à urgence égale. */
export const DASHBOARD_ROLES: DashboardRole[] = ["instruction", "parapheur", "mailroom"];

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

export function instructionTodo(
  items: MailroomItem[],
  scope: ReadonlySet<string> | null,
  draftCount: number,
): TodoCard[] {
  const mine = items.filter((i) => isOpen(i) && inScope(i, scope));
  const card = (c: Omit<TodoCard, "role">): TodoCard => ({ ...c, role: "instruction" });
  return [
    card({
      key: "instruction-late",
      tone: "urgent",
      label: "En retard",
      count: mine.filter(isOverdue).length,
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
    title: scope ? "Mes courriers en instruction" : "Courriers en instruction",
    tabLabel: "Mes courriers",
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

// ─── Indicateurs du mois écoulé ─────────────────────────────────────────────

/** Mois « YYYY-MM » à Paris. */
function parisMonth(value: string | null | undefined): string | null {
  return parisDay(value)?.slice(0, 7) ?? null;
}

/** Le dernier mois complet et celui d'avant, en clés « YYYY-MM ». */
export function kpiMonths(now: Date = new Date()): { current: string; previous: string } {
  const [y, m] = parisDay(now)!.split("-").map(Number);
  const shift = (offset: number) => {
    const d = new Date(Date.UTC(y, m - 1 + offset, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  };
  return { current: shift(-1), previous: shift(-2) };
}

/**
 * Borne du RPC (« résolus depuis ») : la veille du premier jour du mois d'avant
 * le dernier mois complet — un jour de marge absorbe le décalage horaire de Paris.
 */
export function kpiSince(now: Date = new Date()): Date {
  const { previous } = kpiMonths(now);
  return new Date(Date.parse(`${previous}-01T00:00:00Z`) - 86_400_000);
}

const MONTH_FORMAT = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });
const MONTH_ONLY = new Intl.DateTimeFormat("fr-FR", { month: "long", timeZone: "UTC" });

/** « Septembre 2026 » / « août » */
export function monthLabels(now: Date = new Date()): { title: string; previous: string } {
  const { current, previous } = kpiMonths(now);
  const title = MONTH_FORMAT.format(new Date(`${current}-15T12:00:00Z`));
  return {
    title: title.charAt(0).toUpperCase() + title.slice(1),
    previous: MONTH_ONLY.format(new Date(`${previous}-15T12:00:00Z`)),
  };
}

export interface Kpi {
  key: string;
  label: string;
  value: string;
  delta: string | null;
  /** `null` : l'écart n'est ni bon ni mauvais (volume reçu). */
  trend: "good" | "bad" | null;
}

const frNumber = new Intl.NumberFormat("fr-FR");

function percentDelta(cur: number, prev: number): string | null {
  if (prev === 0) return null;
  const pct = Math.round(((cur - prev) / prev) * 100);
  return `${pct > 0 ? "+" : pct < 0 ? "−" : ""}${Math.abs(pct)} %`;
}

function pointsDelta(cur: number | null, prev: number | null): { delta: string | null; diff: number } {
  if (cur === null || prev === null) return { delta: null, diff: 0 };
  const diff = cur - prev;
  return { delta: `${diff > 0 ? "+" : diff < 0 ? "−" : ""}${Math.abs(diff)} pts`, diff };
}

function ratio(part: number, total: number): number | null {
  return total ? Math.round((part / total) * 100) : null;
}

function trendOf(diff: number): Kpi["trend"] {
  return diff > 0 ? "good" : diff < 0 ? "bad" : null;
}

/**
 * Trois indicateurs du dernier mois complet, comparés au mois d'avant :
 * reçus, traités (ou routés en moins d'un jour pour le service courrier),
 * traités dans les délais (parmi les courriers qui ont un objectif).
 */
export function monthKpis(args: {
  items: MailroomItem[];
  scope: ReadonlySet<string> | null;
  routing: boolean;
  now?: Date;
}): Kpi[] {
  const { current, previous } = kpiMonths(args.now);
  const items = args.items.filter((i) => inScope(i, args.scope));
  const receivedIn = (month: string) =>
    items.filter((i) => parisMonth(i.row.received_at ?? i.row.created_at) === month);
  const resolvedIn = (month: string) => items.filter((i) => parisMonth(i.row.resolved_at) === month);

  const received = { cur: receivedIn(current).length, prev: receivedIn(previous).length };
  const kpis: Kpi[] = [
    {
      key: "received",
      label: "Courriers reçus",
      value: frNumber.format(received.cur),
      delta: percentDelta(received.cur, received.prev),
      trend: null,
    },
  ];

  if (args.routing) {
    // Routés en moins d'un jour ouvré, parmi les reçus du mois qui ont été routés.
    const fastShare = (month: string) => {
      const routed = receivedIn(month).filter((i) => i.row.routed_at);
      const fast = routed.filter((i) => {
        const from = parisDay(i.row.received_at ?? i.row.created_at)!;
        return businessDaysBetween(from, parisDay(i.row.routed_at)!) <= 1;
      });
      return ratio(fast.length, routed.length);
    };
    const cur = fastShare(current);
    const { delta, diff } = pointsDelta(cur, fastShare(previous));
    kpis.push({
      key: "routed",
      label: "Routés en moins d'un jour",
      value: cur === null ? "—" : `${cur} %`,
      delta,
      trend: trendOf(diff),
    });
  } else {
    const cur = resolvedIn(current).length;
    const prev = resolvedIn(previous).length;
    kpis.push({
      key: "resolved",
      label: "Courriers traités",
      value: frNumber.format(cur),
      delta: percentDelta(cur, prev),
      trend: trendOf(cur - prev),
    });
  }

  const onTime = (month: string) => {
    const judged = resolvedIn(month).filter((i) => i.sla.resolution.kind === "met" || i.sla.resolution.kind === "missed");
    return ratio(judged.filter((i) => i.sla.resolution.kind === "met").length, judged.length);
  };
  const cur = onTime(current);
  const { delta, diff } = pointsDelta(cur, onTime(previous));
  kpis.push({
    key: "on-time",
    label: "Traités dans les délais",
    value: cur === null ? "—" : `${cur} %`,
    delta,
    trend: trendOf(diff),
  });
  return kpis;
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

