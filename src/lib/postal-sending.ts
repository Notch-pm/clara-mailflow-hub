// Envois papiers réels : libellés et totaux, purs (testés par vitest).

export const POSTAL_SENDING_EXPLANATION =
  "L'envoi papier réel est réalisé par un prestataire et entraîne un coût par envoi. L'envoi peut être réalisé en courrier simple ou en courrier recommandé.";

export type PostalSendingStatus = "pending" | "sent" | "to_verify" | "failed";

const STATUS_LABELS: Record<PostalSendingStatus, string> = {
  pending: "En cours",
  sent: "Envoyé",
  to_verify: "À vérifier",
  failed: "Échec",
};

export function postalSendingStatusLabel(status: string): string {
  return STATUS_LABELS[status as PostalSendingStatus] ?? status;
}

/** Montant en euros, à la française (« 1,23 € »), ou un tiret. */
export function formatEuros(amount: number | string | null | undefined): string {
  if (amount === null || amount === undefined || amount === "") return "—";
  const n = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n);
}

/** Total TTC des envois partis dans le mois civil de `now` (heure locale). */
export function monthTotalTtc(
  rows: { status: string; price_ttc: number | string | null; sent_at: string | null }[],
  now: Date = new Date(),
): { count: number; total: number } {
  let count = 0;
  let total = 0;
  for (const r of rows) {
    if (r.status !== "sent" || !r.sent_at) continue;
    const d = new Date(r.sent_at);
    if (d.getFullYear() !== now.getFullYear() || d.getMonth() !== now.getMonth()) continue;
    count += 1;
    const p = r.price_ttc === null ? 0 : Number(r.price_ttc);
    if (Number.isFinite(p)) total += p;
  }
  return { count, total: Math.round(total * 100) / 100 };
}

/** Le plafond saisi, borné comme en base (0 à 1000), ou `null` s'il est illisible. */
export function parseDailyCap(input: string): number | null {
  if (!/^\d{1,4}$/.test(input.trim())) return null;
  const n = Number(input.trim());
  return n >= 0 && n <= 1000 ? n : null;
}
