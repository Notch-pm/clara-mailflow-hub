import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

/**
 * Enfilement de l'analyse (OCR + LLM) d'un courrier.
 *
 * À préférer à `runFullAnalysis()` dès qu'il s'agit d'un LOT ou d'un courrier
 * créé sans utilisateur devant l'écran. `runFullAnalysis` tient la connexion du
 * navigateur ouverte pendant tout l'OCR : sur un import de 30 courriers, cela
 * fait 30 requêtes longues qu'une simple navigation interrompt. Ici on écrit une
 * ligne, et l'edge function `process-analysis-queue` fait le travail côté
 * serveur, avec reprise sur erreur.
 *
 * L'appel est idempotent : un courrier ayant déjà un job en attente ou en cours
 * n'en obtient pas un second (index unique partiel côté base).
 */

/**
 * `types.ts` est généré et ne connaît pas encore ce RPC : on décrit la signature
 * localement plutôt que de caster en `any`. À supprimer à la prochaine
 * régénération des types.
 */
type EnqueueAnalysisRpc = (
  fn: "enqueue_courier_analysis",
  params: { p_courier_id: string; p_kind?: "ocr" | "analyze" | "full" },
) => Promise<{ data: string | null; error: { message: string } | null }>;

export async function enqueueCourierAnalysis(
  courierId: string,
  kind: "ocr" | "analyze" | "full" = "full",
): Promise<string | null> {
  const { data, error } = await (supabase as unknown as { rpc: EnqueueAnalysisRpc }).rpc(
    "enqueue_courier_analysis",
    { p_courier_id: courierId, p_kind: kind },
  );
  if (error) throw error;
  // NULL = un job était déjà en file pour ce courrier.
  return data;
}

/**
 * Enfile un lot. Les échecs sont journalisés sans interrompre le reste : rater
 * l'analyse d'un courrier ne doit pas invalider un import de 30.
 */
export async function enqueueCourierAnalyses(courierIds: string[]): Promise<number> {
  let queued = 0;
  for (const id of courierIds) {
    try {
      await enqueueCourierAnalysis(id);
      queued++;
    } catch (err) {
      console.error("Enfilement de l'analyse impossible", id, err);
    }
  }
  return queued;
}

export type CourierAnalysisJob = Pick<
  Database["public"]["Tables"]["courier_analysis_jobs"]["Row"],
  "id" | "status" | "last_error" | "created_at" | "finished_at"
>;

/** Dernier job d'analyse du courrier (ou null s'il n'est jamais passé par la file). */
export async function getLatestAnalysisJob(
  organizationId: string,
  courierId: string,
): Promise<CourierAnalysisJob | null> {
  const { data, error } = await supabase
    .from("courier_analysis_jobs")
    .select("id, status, last_error, created_at, finished_at")
    .eq("organization_id", organizationId)
    .eq("courier_id", courierId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export function isAnalysisJobInProgress(job: Pick<CourierAnalysisJob, "status"> | null | undefined): boolean {
  return job?.status === "pending" || job?.status === "running";
}
