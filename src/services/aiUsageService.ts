import { supabase } from "@/integrations/supabase/client";

/**
 * Consommation IA de la collectivité — LECTURE SEULE, ET DEPUIS LE SOCLE.
 *
 * ⚠️ CE MODULE NE LIT PLUS DE TABLE ET N'EN ÉCRIT PLUS AUCUNE. Depuis la
 * centralisation du 2026-08-29, le plafond, le compteur et la période vivent
 * dans le Socle (`ai-api`), qui les tient pour TOUTE la gamme (Clara, Iris,
 * Ariane). Les tables `ai_usage_quotas` / `ai_usage_counters` /
 * `ai_usage_events` de Clara ont été supprimées
 * (`20260829140000_retrait_plafond_ia.sql`) : les relire renverrait aujourd'hui
 * une erreur, et les recréer rouvrirait un SECOND COMPTEUR — un tableau qui
 * afficherait zéro pendant que la collectivité dépense son mois ailleurs.
 *
 * ⚠️ `upsertAiUsageQuota` A ÉTÉ SUPPRIMÉE le 2026-08-29 — ne pas la
 * réintroduire. Le plafond se règle dans le Socle : le fixer depuis Clara ne
 * porterait que sur la part de Clara, c'est-à-dire sur rien, puisque le
 * compteur est commun à la gamme.
 *
 * ⚠️ NI PÉRIODE NI DATE DE RENOUVELLEMENT NE SONT CALCULÉES ICI. Le Socle les
 * possède et les rend à chaque lecture ; Clara ne fait que les mettre en
 * français. C'était le jumeau le plus dangereux du chantier — deux calculs de
 * période qui dérivent ne cassent rien de visible, ils font simplement MENTIR
 * le message (« renouvelé le 1ᵉʳ octobre » quand la période du Socle est encore
 * en août).
 */

/** Une application de la gamme, et ce qu'elle a consommé sur la période. */
export interface AiUsageConsumer {
  consumer: string;
  feature: string | null;
  calls: number;
  tokens: number;
}

export interface AiUsageSummary {
  /** Période courante telle que le Socle la nomme, format 'YYYY-MM'. */
  period: string;
  /** Date de renouvellement du crédit (ISO 'YYYY-MM-DD'), venue du Socle. */
  renewsAt: string | null;
  /** `null` = aucun plafond configuré ⇒ consommation illimitée. */
  limitTokens: number | null;
  usedTokens: number;
  reservedTokens: number;
  /** Ventilation par application de la gamme, la seule vue que Clara ne peut pas produire seule. */
  byConsumer: AiUsageConsumer[];
}

/**
 * Lit la consommation de la collectivité pour la période demandée (le mois en
 * cours par défaut).
 *
 * Passe par l'edge function `socle-ai-usage` : la clé API du Socle est un
 * secret serveur, le navigateur n'appelle jamais le Socle en direct. La garde
 * d'accès (membre actif de l'organisation, ou superadmin) vit dans cette
 * fonction — c'est la seule, le RLS ne s'appliquant plus à une lecture faite
 * en `service_role`.
 */
export async function getAiUsageSummary(
  organizationId: string,
  period?: string,
): Promise<AiUsageSummary> {
  const { data, error } = await supabase.functions.invoke("socle-ai-usage", {
    body: { organization_id: organizationId, ...(period ? { period } : {}) },
  });
  if (error) throw error;

  const usage = (data as { usage?: unknown } | null)?.usage as
    | Record<string, unknown>
    | undefined;

  return {
    period: typeof usage?.period === "string" ? usage.period : "",
    renewsAt: typeof usage?.renews_at === "string" ? usage.renews_at : null,
    limitTokens: typeof usage?.limit === "number" ? usage.limit : null,
    usedTokens: typeof usage?.used_tokens === "number" ? usage.used_tokens : 0,
    reservedTokens: typeof usage?.reserved_tokens === "number" ? usage.reserved_tokens : 0,
    byConsumer: Array.isArray(usage?.by_consumer)
      ? (usage.by_consumer as AiUsageConsumer[])
      : [],
  };
}

const MONTHS = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
] as const;

/**
 * « 1ᵉʳ septembre 2026 » à partir d'une date ISO VENUE DU SOCLE.
 *
 * Composée à la main plutôt que par `Intl.DateTimeFormat` : le renouvellement
 * tombe toujours un premier du mois, qui s'écrit « 1ᵉʳ » et non « 1 » en
 * français — et une sortie ICU varie d'une version de runtime à l'autre, ce qui
 * rendrait le test fragile sans qu'aucun comportement n'ait bougé.
 *
 * Une entrée qui n'est pas une date est rendue telle quelle : mieux vaut
 * afficher ce que le serveur a dit qu'inventer un mois.
 */
export function renewalLabel(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  const day = date.getUTCDate();
  const prefix = day === 1 ? "1ᵉʳ" : String(day);
  return `${prefix} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

export type QuotaTone = "ok" | "warn" | "critical";

export interface QuotaView {
  unlimited: boolean;
  limitTokens: number | null;
  usedTokens: number;
  reservedTokens: number;
  /** Consommé + réservé : ce qui est réellement engagé sur le mois. */
  engagedTokens: number;
  /** Jetons restants, jamais négatif. `null` si illimité. */
  remainingTokens: number | null;
  /** 0 à 100, borné — un dépassement ne fait pas déborder la jauge. */
  percent: number;
  tone: QuotaTone;
}

/** Seuil d'alerte : au-delà, la jauge passe en avertissement. */
const WARN_AT = 80;

/**
 * Ce que l'écran affiche.
 *
 * `reservedTokens` compte dans l'engagé : un appel en cours a déjà mordu sur le
 * plafond, et l'ignorer ferait annoncer un reliquat qui n'existe pas.
 *
 * ⚠️ LE RATIO EST LA VÉRITÉ ; `percent` n'est qu'un affichage (arrondi et
 * borné). Le ton se décide donc sur le ratio, jamais sur `percent` — sinon
 * 799/1000 (79,9 %) s'arrondirait à 80 et déclencherait une alerte que l'engagé
 * réel ne justifie pas, et un dépassement à 150 % serait ramené à 100 puis lu
 * comme un simple avertissement.
 */
export function quotaView(summary: AiUsageSummary): QuotaView {
  const usedTokens = Math.max(summary.usedTokens, 0);
  const reservedTokens = Math.max(summary.reservedTokens, 0);
  const engagedTokens = usedTokens + reservedTokens;
  const limitTokens = summary.limitTokens;

  if (limitTokens === null || limitTokens <= 0) {
    return {
      unlimited: true,
      limitTokens: null,
      usedTokens,
      reservedTokens,
      engagedTokens,
      remainingTokens: null,
      percent: 0,
      tone: "ok",
    };
  }

  const ratio = engagedTokens / limitTokens;
  return {
    unlimited: false,
    limitTokens,
    usedTokens,
    reservedTokens,
    engagedTokens,
    remainingTokens: Math.max(limitTokens - engagedTokens, 0),
    percent: Math.min(100, Math.round(ratio * 100)),
    tone: ratio >= 1 ? "critical" : ratio * 100 >= WARN_AT ? "warn" : "ok",
  };
}

/**
 * « 1 250 000 » — espace fine insécable (U+202F), le séparateur français.
 * Composé à la main pour la même raison que la date : `toLocaleString` change
 * de séparateur selon la version d'ICU (espace insécable ordinaire hier, fine
 * aujourd'hui), et le test se briserait sur un changement de runtime sans
 * qu'aucun comportement n'ait bougé.
 */
export function formatTokens(value: number): string {
  return String(Math.round(Math.max(value, 0))).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}
