// Edge function: process-analysis-queue
//
// Worker de la file `courier_analysis_jobs`. Réserve quelques jobs, appelle
// analyze-courier (OCR puis analyse LLM) pour chacun, et clôt le job.
//
// Modes :
//  - POST avec header x-cron-secret => exécution normale (cron, toutes les minutes)
//
// POURQUOI CETTE FONCTION. Les chemins d'ingestion (IMAP, import en masse) ne
// peuvent pas océriser en ligne : c'est long, coûteux en quota, et une erreur
// ferait perdre tout le lot. Ils enfilent donc un job, que ce worker consomme.

import { createClient } from "npm:@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/** Nombre de courriers traités par exécution. Volontairement bas : chaque job
 *  peut enchaîner plusieurs OCR, et l'edge function a un temps d'exécution
 *  borné. Le cron repasse toutes les minutes, la file se vide progressivement. */
const JOBS_PER_RUN = 3;
/** Au-delà, le job est abandonné définitivement. */
const MAX_ATTEMPTS = 3;

interface AnalysisJob {
  id: string;
  organization_id: string;
  courier_id: string;
  kind: "ocr" | "analyze" | "full";
  attempts: number;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function getCronSecret(admin: ReturnType<typeof createClient>): Promise<string> {
  try {
    const { data, error } = await admin.rpc("get_cron_secret");
    if (error) {
      console.error("get_cron_secret RPC error:", error.message);
      return "";
    }
    return (data as string) ?? "";
  } catch (e) {
    console.error("get_cron_secret exception:", e);
    return "";
  }
}

/** Appelle analyze-courier en interne, authentifié par le secret cron. */
async function callAnalyzeCourier(
  action: "ocr-courier" | "analyze",
  orgId: string,
  courierId: string,
  cronSecret: string,
): Promise<{ ok: boolean; quotaExceeded: boolean; error?: string }> {
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/analyze-courier?action=${action}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-org-id": orgId,
      "x-cron-secret": cronSecret,
      // analyze-courier n'utilise pas ce jeton (la branche cron court-circuite
      // verifyAuth), mais la plateforme rejette les appels sans Authorization.
      Authorization: `Bearer ${SERVICE_ROLE}`,
    },
    body: JSON.stringify({ courier_id: courierId }),
  });

  const payload = await resp.json().catch(() => ({}));

  if (resp.status === 429) return { ok: false, quotaExceeded: true, error: "quota_exceeded" };
  if (!resp.ok) {
    return { ok: false, quotaExceeded: false, error: payload?.error ?? `HTTP ${resp.status}` };
  }
  // ocr-courier répond 200 même si des documents ont échoué : le quota épuisé
  // en cours de lot remonte par ce drapeau, pas par le statut HTTP.
  if (payload?.quotaExceeded) return { ok: false, quotaExceeded: true, error: "quota_exceeded" };
  return { ok: true, quotaExceeded: false };
}

/** Début du mois suivant : les quotas IA sont mensuels, réessayer avant ne sert
 *  à rien et brûlerait les tentatives restantes. */
function startOfNextMonth(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  const provided = req.headers.get("x-cron-secret");
  const expected = await getCronSecret(admin);
  if (!provided || !expected || provided !== expected) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  // Rend leur chance aux jobs laissés 'running' par un worker interrompu :
  // sans cela, l'index unique partiel bloque toute nouvelle analyse du courrier.
  const { data: requeued, error: requeueErr } = await admin.rpc("requeue_stale_analysis_jobs", {
    p_older_than: "10 minutes",
  });
  if (requeueErr) console.error("requeue_stale_analysis_jobs:", requeueErr.message);

  const { data: jobs, error: claimErr } = await admin.rpc("claim_analysis_jobs", {
    p_limit: JOBS_PER_RUN,
  });
  if (claimErr) {
    console.error("claim_analysis_jobs:", claimErr.message);
    return jsonResponse({ error: claimErr.message }, 500);
  }

  const claimed = (jobs ?? []) as AnalysisJob[];
  let done = 0;
  let failed = 0;
  let deferred = 0;

  for (const job of claimed) {
    try {
      let outcome = { ok: true, quotaExceeded: false, error: undefined as string | undefined };

      if (job.kind === "full" || job.kind === "ocr") {
        outcome = await callAnalyzeCourier("ocr-courier", job.organization_id, job.courier_id, provided);
      }
      // L'analyse LLM n'a de sens qu'avec des extraits : on ne l'enchaîne que si
      // l'OCR a réussi.
      if (outcome.ok && (job.kind === "full" || job.kind === "analyze")) {
        outcome = await callAnalyzeCourier("analyze", job.organization_id, job.courier_id, provided);
      }

      if (outcome.ok) {
        await admin
          .from("courier_analysis_jobs")
          .update({ status: "done", finished_at: new Date().toISOString(), last_error: null })
          .eq("id", job.id);
        done++;
        continue;
      }

      if (outcome.quotaExceeded) {
        // Report SANS consommer de tentative : le quota n'est pas un défaut du
        // job. Sans ce rollback, trois passages de cron suffiraient à abandonner
        // définitivement un courrier parfaitement analysable le mois suivant.
        await admin
          .from("courier_analysis_jobs")
          .update({
            status: "pending",
            attempts: Math.max(0, job.attempts - 1),
            scheduled_at: startOfNextMonth(),
            last_error: "quota_exceeded",
            started_at: null,
          })
          .eq("id", job.id);
        deferred++;
        continue;
      }

      const giveUp = job.attempts >= MAX_ATTEMPTS;
      await admin
        .from("courier_analysis_jobs")
        .update({
          status: giveUp ? "failed" : "pending",
          last_error: outcome.error ?? "unknown",
          finished_at: giveUp ? new Date().toISOString() : null,
          started_at: null,
          // Réessai espacé : une erreur immédiate se reproduit souvent à l'identique.
          scheduled_at: giveUp
            ? new Date().toISOString()
            : new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        })
        .eq("id", job.id);
      failed++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown";
      console.error(`Job ${job.id} exception:`, msg);
      await admin
        .from("courier_analysis_jobs")
        .update({
          status: job.attempts >= MAX_ATTEMPTS ? "failed" : "pending",
          last_error: msg,
          started_at: null,
        })
        .eq("id", job.id);
      failed++;
    }
  }

  return jsonResponse({
    claimed: claimed.length,
    done,
    failed,
    deferred,
    requeued: requeued ?? 0,
  });
});
