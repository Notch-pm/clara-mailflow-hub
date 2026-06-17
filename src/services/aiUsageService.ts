import { supabase } from "@/integrations/supabase/client";

export interface AiUsageSummary {
  /** null = plafond global appliqué à tous les fournisseurs confondus. */
  provider: string | null;
  /** Période courante, format 'YYYY-MM'. */
  period: string;
  monthlyLimitTokens: number;
  usedTokens: number;
  reservedTokens: number;
  isActive: boolean;
}

function currentPeriod(): string {
  return new Date().toISOString().slice(0, 7);
}

/**
 * Lit le(s) plafond(s) configuré(s) pour l'organisation, fusionnés avec le
 * compteur de la période courante (0 si aucun appel n'a encore été passé ce
 * mois-ci). Protégé par RLS (is_member_of) : lisible par tout membre de l'org.
 * Retourne un tableau vide si aucun plafond n'est configuré (= illimité).
 */
export async function getAiUsageSummary(organizationId: string): Promise<AiUsageSummary[]> {
  const period = currentPeriod();

  const { data: quotas, error: quotasError } = await supabase
    .from("ai_usage_quotas" as never)
    .select("provider, monthly_limit_tokens, is_active")
    .eq("organization_id", organizationId);
  if (quotasError) throw quotasError;

  const { data: counters, error: countersError } = await supabase
    .from("ai_usage_counters" as never)
    .select("provider, used_tokens, reserved_tokens")
    .eq("organization_id", organizationId)
    .eq("period", period);
  if (countersError) throw countersError;

  type QuotaRow = { provider: string | null; monthly_limit_tokens: number; is_active: boolean };
  type CounterRow = { provider: string | null; used_tokens: number; reserved_tokens: number };

  return ((quotas ?? []) as unknown as QuotaRow[]).map((q) => {
    const counter = ((counters ?? []) as unknown as CounterRow[]).find((c) => c.provider === q.provider);
    return {
      provider: q.provider,
      period,
      monthlyLimitTokens: q.monthly_limit_tokens,
      usedTokens: counter?.used_tokens ?? 0,
      reservedTokens: counter?.reserved_tokens ?? 0,
      isActive: q.is_active,
    };
  });
}

/**
 * Crée ou met à jour le plafond mensuel d'une organisation pour un fournisseur
 * donné (null = plafond global). Réservé aux superadmins (policy RLS
 * superadmin_write sur ai_usage_quotas) — les admins d'organisation n'ont
 * qu'un accès en lecture à ces données.
 */
export async function upsertAiUsageQuota(
  organizationId: string,
  provider: string | null,
  monthlyLimitTokens: number,
): Promise<void> {
  const { error } = await supabase.from("ai_usage_quotas" as never).upsert(
    {
      organization_id: organizationId,
      provider,
      monthly_limit_tokens: monthlyLimitTokens,
      is_active: true,
    } as never,
    { onConflict: "organization_id,provider" },
  );
  if (error) throw error;
}
