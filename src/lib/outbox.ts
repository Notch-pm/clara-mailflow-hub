/**
 * Écran « Courriers sortants » : le classement en onglets, sans React ni
 * Supabase (même découpage que `src/lib/mailroom.ts` pour l'entrant).
 *
 * Un sortant est rangé par ce qui l'attend, dans cet ordre — la première règle
 * qui joue l'emporte :
 *
 * 1. **Envoyés** : parti par courriel (`sent_email_at`), marqué posté
 *    (`posted_at`), ou dans un état final. `sent_at` seul ne prouve rien : les
 *    anciennes réponses le portaient dès leur création (spec sortants, ADR-4).
 * 2. **En attente de visa** : état qui exige un visa.
 * 3. **En attente de signature** : état qui exige une signature, pas encore apposée.
 * 4. **Prêt à l'envoi** : étape d'envoi, ou déjà signé.
 * 5. **En rédaction** : tout le reste — état initial, « à corriger », sans état.
 */
import { waitingDays } from "@/lib/elu-delay";
import { outboundKind, type OutboundKind } from "@/lib/outbound-kind";
import type { OutboxRow } from "@/services/outboxService";

export type OutboxStage = "redaction" | "visa" | "signature" | "envoi" | "envoyes";
export type OutboxView = OutboxStage | "tous";

export interface OutboxItem {
  row: OutboxRow;
  stage: OutboxStage;
  kind: OutboundKind;
  /** Jours passés dans l'état courant (0 pour un courrier parti). */
  waitingDays: number;
  /** Date de départ d'un courrier envoyé, sinon null. */
  sentOn: string | null;
}

function isSent(row: OutboxRow): boolean {
  return !!row.sent_email_at || !!row.posted_at || row.state_is_final;
}

export function outboxStage(row: OutboxRow): OutboxStage {
  if (isSent(row)) return "envoyes";
  if (row.state_requires_visa) return "visa";
  if (row.state_requires_signature && !row.signed_at) return "signature";
  if (row.state_is_send || row.signed_at) return "envoi";
  return "redaction";
}

export function classifyOutbound(row: OutboxRow, now: Date = new Date()): OutboxItem {
  const stage = outboxStage(row);
  return {
    row,
    stage,
    kind: outboundKind(row.parent_courier_id),
    waitingDays: stage === "envoyes" ? 0 : waitingDays(row.state_since, now),
    // Un état final sans marqueur (réponse d'avant les sortants) : `sent_at`,
    // posé alors à la création, est la seule date dont on dispose.
    sentOn: stage === "envoyes" ? (row.sent_email_at ?? row.posted_at ?? row.sent_at ?? null) : null,
  };
}

/** L'objet du courrier reçu pour une réponse — c'est sous lui qu'on la cherche —, le sien sinon. */
export function outboxTitle(item: OutboxItem): string {
  return item.row.parent_subject || item.row.subject || "Sans objet";
}

export interface OutboxViewDef {
  label: string;
  description: string;
  empty: string;
}

export const OUTBOX_VIEWS: Record<OutboxView, OutboxViewDef> = {
  redaction: {
    label: "En rédaction",
    description: "Brouillons et courriers à corriger",
    empty: "Aucun courrier en rédaction.",
  },
  visa: {
    label: "En attente de visa",
    description: "Le visa d'un viseur est attendu",
    empty: "Aucun courrier en attente de visa.",
  },
  signature: {
    label: "En attente de signature",
    description: "La signature d'un signataire est attendue",
    empty: "Aucun courrier en attente de signature.",
  },
  envoi: {
    label: "Prêt à l'envoi",
    description: "Signés ou à l'étape d'envoi, pas encore partis",
    empty: "Aucun courrier prêt à l'envoi.",
  },
  envoyes: {
    label: "Envoyés",
    description: "Partis par courriel, postés ou clôturés sur la période",
    empty: "Aucun courrier envoyé sur la période.",
  },
  tous: {
    label: "Tous",
    description: "Tous les courriers sortants",
    empty: "Aucun courrier sortant.",
  },
};

export const OUTBOX_VIEW_ORDER: OutboxView[] = ["redaction", "visa", "signature", "envoi", "envoyes", "tous"];

export function isOutboxView(value: string | null | undefined): value is OutboxView {
  return !!value && (OUTBOX_VIEW_ORDER as string[]).includes(value);
}

export function inOutboxView(item: OutboxItem, view: OutboxView): boolean {
  return view === "tous" || item.stage === view;
}

export type OutboxCounts = Record<OutboxView, number>;

export function countOutboxViews(items: readonly OutboxItem[]): OutboxCounts {
  const counts: OutboxCounts = { redaction: 0, visa: 0, signature: 0, envoi: 0, envoyes: 0, tous: items.length };
  for (const item of items) counts[item.stage] += 1;
  return counts;
}

export interface OutboxFilters {
  query: string;
  serviceId: string | null;
  channels: string[];
  kinds: OutboundKind[];
}

export const EMPTY_OUTBOX_FILTERS: OutboxFilters = { query: "", serviceId: null, channels: [], kinds: [] };

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function matchesOutboxFilters(item: OutboxItem, filters: OutboxFilters): boolean {
  const { row } = item;
  if (filters.channels.length && !filters.channels.includes(row.channel)) return false;
  if (filters.kinds.length && !filters.kinds.includes(item.kind)) return false;
  if (filters.serviceId && row.socle_organization_id !== filters.serviceId) return false;
  const q = normalize(filters.query.trim());
  if (!q) return true;
  return normalize(
    [row.subject, row.parent_subject, row.chrono, row.parent_chrono, row.recipient_name].filter(Boolean).join(" "),
  ).includes(q);
}

const time = (value: string | null | undefined) => (value ? new Date(value).getTime() : 0);

/**
 * Les files (rédaction, visa, signature, envoi) : le plus ancien dans son état
 * d'abord — c'est lui qui attend. Envoyés et Tous : le plus récent d'abord.
 */
export function sortOutbox(items: readonly OutboxItem[], view: OutboxView): OutboxItem[] {
  const list = [...items];
  if (view === "envoyes") return list.sort((a, b) => time(b.sentOn ?? b.row.created_at) - time(a.sentOn ?? a.row.created_at));
  if (view === "tous") return list.sort((a, b) => time(b.row.created_at) - time(a.row.created_at));
  return list.sort((a, b) => time(a.row.state_since) - time(b.row.state_since));
}
