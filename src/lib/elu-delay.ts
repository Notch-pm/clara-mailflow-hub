/**
 * Ancienneté d'une attente, en jours de calendrier.
 *
 * On compare des dates CIVILES locales, jamais une différence de millisecondes
 * divisée par 86 400 000 : une réponse passée en signature hier à 23 h 55
 * attend « depuis 1 jour » dès ce matin, pas « depuis 0 jour » jusqu'à 23 h 55
 * ce soir. C'est ainsi que l'élu compte, et c'est ce que dit la maquette.
 */
export function waitingDays(since: string | Date | null | undefined, now: Date = new Date()): number {
  if (!since) return 0;
  const start = typeof since === "string" ? new Date(since) : since;
  if (Number.isNaN(start.getTime())) return 0;

  const startDay = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const nowDay = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.round((nowDay - startDay) / 86_400_000));
}

/** « En attente depuis 3 jours », tel que l'affiche la pastille de la file. */
export function waitingLabel(days: number): string {
  if (days <= 0) return "Arrivé aujourd'hui";
  if (days === 1) return "En attente depuis 1 jour";
  return `En attente depuis ${days} jours`;
}

/** « Le plus ancien attend depuis 3 jours », sous le compteur de l'accueil. */
export function oldestWaitingLabel(days: number): string {
  if (days <= 0) return "Tous arrivés aujourd'hui";
  if (days === 1) return "Le plus ancien attend depuis 1 jour";
  return `Le plus ancien attend depuis ${days} jours`;
}
