/**
 * Règles d'affichage du parapheur, sans React ni Supabase.
 *
 * Le parapheur rassemble les deux files d'un « décideur » — les réponses à
 * viser, les réponses à signer — et ce qu'il a déjà traité. Viseur et
 * signataire sont deux attributs indépendants : chacun n'ouvre que son onglet.
 */

export type ParapheurTab = "visa" | "signature" | "done";

/** « Mes courriers » ou « Toute l'organisation » (onglet À viser). */
export type VisaScope = "mine" | "all";

export const PARAPHEUR_TAB_LABELS: Record<ParapheurTab, string> = {
  visa: "À viser",
  signature: "À signer",
  done: "Traités",
};

export function parapheurTabs(
  membership: { is_signataire?: boolean | null; is_viseur?: boolean | null } | null | undefined,
): ParapheurTab[] {
  const tabs: ParapheurTab[] = [];
  if (membership?.is_viseur) tabs.push("visa");
  if (membership?.is_signataire) tabs.push("signature");
  tabs.push("done");
  return tabs;
}

/**
 * « Mes courriers » garde aussi les réponses sans viseur désigné : elles
 * attendent n'importe quel viseur, donc moi. Seules sortent celles qu'un autre
 * viseur est attendu pour viser — viser à sa place reste permis, mais c'est un
 * choix qu'on fait en élargissant la vue.
 */
export function inVisaScope(item: { designatedToOther: boolean }, scope: VisaScope): boolean {
  return scope === "all" || !item.designatedToOther;
}

/**
 * Qui sélectionner une fois `removedIds` sortis de la file : la ligne qui
 * prend la place de la courante, sinon la dernière — on enchaîne sans
 * remonter en haut de la liste.
 */
export function nextSelection(
  ids: readonly string[],
  currentId: string | null,
  removedIds: readonly string[],
): string | null {
  const removed = new Set(removedIds);
  const rest = ids.filter((id) => !removed.has(id));
  if (rest.length === 0) return null;
  if (currentId && !removed.has(currentId)) return currentId;
  const index = currentId ? ids.indexOf(currentId) : 0;
  // Les lignes retirées AVANT la courante décalent sa place d'autant.
  const shift = ids.slice(0, Math.max(0, index)).filter((id) => removed.has(id)).length;
  return rest[Math.min(Math.max(0, index - shift), rest.length - 1)];
}

/** Une attente de 5 jours ou plus se signale. */
export const LATE_AFTER_DAYS = 5;

/** « Aujourd'hui », « 1 j », « 6 j » — la pastille compacte d'une ligne. */
export function shortWaitLabel(days: number): string {
  return days <= 0 ? "Aujourd'hui" : `${days} j`;
}

/** Début du mois civil en cours : « Traités » couvre ce mois-ci. */
export function startOfMonthIso(now: Date = new Date()): string {
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
}
