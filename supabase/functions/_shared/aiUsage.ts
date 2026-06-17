// Module générique de garde de quota IA, partagé par toutes les edge functions
// qui appellent un fournisseur IA (Mistral aujourd'hui, potentiellement
// d'autres demain). Implémente le pattern "Reserve -> Call -> Settle" :
// réserve le quota estimé en base AVANT l'appel fournisseur (rejette sans
// même appeler le fournisseur si le quota est dépassé), puis règle la
// réservation après l'appel (succès -> consommation réelle, échec -> la
// réservation est libérée, jamais imputée au quota réel).
//
// Important : ce module ne contient AUCUNE logique spécifique à un
// fournisseur. `provider` n'est qu'une étiquette de reporting passée par
// l'appelant ; l'extraction du nombre de tokens réel depuis la réponse du
// fournisseur reste la responsabilité de l'appelant (qui seul connaît la
// forme de cette réponse).
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

export type AiResourceType = "ocr" | "chat" | "agent";

export class AiQuotaExceededError extends Error {
  constructor(message = "Quota IA mensuel atteint pour cette organisation") {
    super(message);
    this.name = "AiQuotaExceededError";
  }
}

interface ReserveResult {
  event_id: string | null;
  allowed: boolean;
  reason: string;
}

interface WithAiUsageGuardArgs<T> {
  admin: SupabaseClient;
  organizationId: string;
  /** Étiquette de reporting (ex. "mistral") — aucun branchement sur cette valeur ici. */
  provider: string;
  resourceType: AiResourceType;
  /** Borne haute raisonnable, pas besoin d'être exacte : settle() corrige avec la valeur réelle. */
  estimatedTokens: number;
  userId?: string | null;
  /** Effectue l'appel fournisseur. Doit retourner le nombre de tokens réel si
   *  connu (pour que settle() enregistre la consommation exacte), ou null si
   *  le fournisseur ne le communique pas (l'appelant peut alors transmettre
   *  une estimation post-hoc, ex. heuristique sur la longueur de la réponse). */
  run: () => Promise<{ result: T; actualTokens: number | null }>;
}

/**
 * Réserve le quota, exécute l'appel IA, règle la réservation (complétée ou
 * libérée). Lève `AiQuotaExceededError` AVANT d'appeler le fournisseur si la
 * réservation est refusée. Relance l'erreur d'origine de `run()` inchangée
 * après l'avoir réglée en 'failed', pour que la gestion d'erreur existante de
 * chaque edge function continue de fonctionner sans modification.
 */
export async function withAiUsageGuard<T>(args: WithAiUsageGuardArgs<T>): Promise<T> {
  const { admin, organizationId, provider, resourceType, estimatedTokens, userId, run } = args;

  const { data, error } = await admin.rpc("reserve_ai_usage", {
    p_org_id: organizationId,
    p_provider: provider,
    p_resource_type: resourceType,
    p_estimated_tokens: estimatedTokens,
    p_user_id: userId ?? null,
  });
  if (error) throw new Error(`reserve_ai_usage failed: ${error.message}`);

  const reservation = (Array.isArray(data) ? data[0] : data) as ReserveResult | undefined;
  if (!reservation || !reservation.allowed) {
    throw new AiQuotaExceededError();
  }

  const eventId = reservation.event_id;

  try {
    const { result, actualTokens } = await run();
    if (eventId) {
      await admin.rpc("settle_ai_usage", {
        p_event_id: eventId,
        p_actual_tokens: actualTokens,
        p_status: "completed",
      });
    }
    return result;
  } catch (err) {
    if (eventId) {
      // Règlement best-effort : une erreur ici ne doit jamais masquer l'erreur
      // d'origine, plus importante. Le balayage périodique (cron) est le vrai
      // filet de sécurité si ce settle échoue.
      await admin
        .rpc("settle_ai_usage", { p_event_id: eventId, p_actual_tokens: null, p_status: "failed" })
        .catch((settleErr: unknown) => {
          console.error("settle_ai_usage(failed) error (auto-résolu par le cron de nettoyage):", settleErr);
        });
    }
    throw err;
  }
}

/** Estimation générique pour les appels chat/agent : taille du prompt + budget de sortie maximal. */
export function estimateTextTokens(promptChars: number, maxOutputTokens: number): number {
  return Math.ceil(promptChars / 4) + maxOutputTokens;
}

/** Estimation générique pour l'OCR, à partir d'un nombre de pages (approximatif si inconnu). */
export function estimateOcrTokens(pageCountGuess: number): number {
  return Math.max(500, pageCountGuess * 400);
}

/** Tokens réels post-appel quand le fournisseur ne renvoie pas d'usage exploitable pour l'OCR. */
export function estimateTokensFromText(text: string): number {
  return Math.ceil(text.length / 4);
}
