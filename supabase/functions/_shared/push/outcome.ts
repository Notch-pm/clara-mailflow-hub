// Décision après un envoi push vers N appareils — module PUR, testé.
//
// Une notification est réglée « envoyée » dès qu'UN appareil l'a reçue : le
// destinataire est prévenu, c'est ce qui compte, et réessayer pour son second
// téléphone le ferait vibrer deux fois. Un appareil disparu (404 ou 410 du
// service de push) est désactivé, jamais réessayé. Le reste (429, 5xx, réseau)
// remet la ligne en file avec temporisation ; 401/403 signalent une
// configuration VAPID fausse — on réessaie aussi, mais l'erreur le dit, car
// c'est le seul cas où toute la file est en panne et non un appareil.

export interface DeliveryResult {
  subscriptionId: string;
  /** Code HTTP du service de push, `null` si l'appel n'a pas abouti. */
  status: number | null;
  error?: string;
}

export interface Outcome {
  settle: "sent" | "retry";
  /** Abonnements à désactiver (404/410). */
  disable: string[];
  /** Résumé pour `push_error` — jamais un endpoint, jamais un texte de message. */
  error: string | null;
}

/** Le service de push dit que l'abonnement n'existe plus. */
export function isGone(status: number | null): boolean {
  return status === 404 || status === 410;
}

function isOk(status: number | null): boolean {
  return status !== null && status >= 200 && status < 300;
}

export function decideOutcome(results: DeliveryResult[]): Outcome {
  if (results.length === 0) {
    return { settle: "retry", disable: [], error: "aucun appareil" };
  }
  const disable = results.filter((r) => isGone(r.status)).map((r) => r.subscriptionId);
  const anySent = results.some((r) => isOk(r.status));
  if (anySent) return { settle: "sent", disable, error: null };

  const failures = results.filter((r) => !isGone(r.status));
  const parts = failures.map((r) => {
    if (r.status === 401 || r.status === 403) return `HTTP ${r.status} (clés VAPID refusées)`;
    if (r.status !== null) return `HTTP ${r.status}`;
    return r.error?.trim() || "erreur réseau";
  });
  const error = parts.length > 0
    ? Array.from(new Set(parts)).join(" · ")
    : "tous les appareils ont disparu";
  return { settle: "retry", disable, error: error.slice(0, 500) };
}
