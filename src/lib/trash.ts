/**
 * Corbeille des courriers. La durée fait foi côté SQL (`purge_expired_data`,
 * migration `20261001120000_corbeille_courriers.sql`) ; elle n'est reprise ici
 * que pour l'affichage.
 */
export const TRASH_RETENTION_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Jours restants avant la suppression définitive, arrondis au jour supérieur :
 * « dans 1 jour » jusqu'au dernier moment, jamais négatif (la purge passe la
 * nuit, un courrier échu peut rester visible quelques heures).
 */
export function daysUntilPurge(purgeAt: string | Date, now: Date = new Date()): number {
  const remaining = new Date(purgeAt).getTime() - now.getTime();
  if (!Number.isFinite(remaining) || remaining <= 0) return 0;
  return Math.ceil(remaining / DAY_MS);
}

/** « Supprimé définitivement dans 3 jours » / « demain » / « cette nuit ». */
export function purgeLabel(days: number): string {
  if (days <= 0) return "Cette nuit";
  if (days === 1) return "Demain";
  return `Dans ${days} jours`;
}
