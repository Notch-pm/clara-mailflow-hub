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

/** Taille d'un lot réclamé. Volontairement bas : chaque job peut enchaîner
 *  plusieurs OCR. */
const JOBS_PER_RUN = 3;
/**
 * Depuis le 2026-10-01, une exécution enchaîne les lots tant que la file en a
 * et que ce budget n'est pas épuisé (l'edge function a un temps d'exécution
 * borné : un job entamé juste avant l'échéance doit encore tenir). Avant, elle
 * s'arrêtait après 3 jobs et le reste attendait le cron suivant, 2 minutes plus
 * tard. Elle est maintenant aussi réveillée dès l'entrée d'un job en file
 * (trigger `courier_analysis_jobs_wake_worker`), le cron restant le filet.
 */
const RUN_BUDGET_MS = 75_000;
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

/**
 * Ce que rend un appel à analyze-courier.
 *
 * `kind` remplace l'ancien couple `{ ok, quotaExceeded }` : depuis la
 * centralisation IA, un refus n'a plus deux formes mais trois, et une seule
 * d'entre elles justifie d'endormir le job jusqu'au mois suivant.
 */
type CallOutcome =
  | { ok: true; kind: "ok"; error?: undefined }
  | { ok: false; kind: "quota_exceeded"; error: string; renewsAt: string | null }
  | { ok: false; kind: "rate_limited"; error: string }
  | { ok: false; kind: "error"; error: string };

/** Appelle analyze-courier en interne, authentifié par le secret cron. */
async function callAnalyzeCourier(
  action: "ocr-courier" | "analyze",
  orgId: string,
  courierId: string,
  cronSecret: string,
): Promise<CallOutcome> {
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

  // ⚠️ DEUX REFUS PARTAGENT LE 429 DEPUIS LA CENTRALISATION IA, et les
  // confondre coûterait un mois. Le plafond de la collectivité est épuisé :
  // rien à tenter avant son renouvellement. La CADENCE est dépassée : le
  // crédit est intact, il suffit d'attendre quelques secondes. Avant le
  // guichet, seul le premier cas existait — d'où l'ancien « tout 429 vaut
  // quota », qui endormirait aujourd'hui jusqu'au mois suivant un courrier
  // simplement arrivé dans une rafale.
  if (resp.status === 429) {
    if (payload?.code === "ai_rate_limited") {
      return { ok: false, kind: "rate_limited", error: "ai_rate_limited" };
    }
    return {
      ok: false,
      kind: "quota_exceeded",
      error: "quota_exceeded",
      // Date du Socle, jamais recalculée ici (voir `deferUntil`).
      renewsAt: typeof payload?.renews_at === "string" ? payload.renews_at : null,
    };
  }
  if (!resp.ok) {
    return { ok: false, kind: "error", error: payload?.error ?? `HTTP ${resp.status}` };
  }
  // ocr-courier répond 200 même si des documents ont échoué : le quota épuisé
  // en cours de lot remonte par ce drapeau, pas par le statut HTTP.
  if (payload?.quotaExceeded) {
    return { ok: false, kind: "quota_exceeded", error: "quota_exceeded", renewsAt: null };
  }
  return { ok: true, kind: "ok" };
}

/**
 * Quand replanifier un job reporté faute de crédit.
 *
 * ⚠️ LA DATE DU SOCLE PRIME, TOUJOURS. Depuis la centralisation, le plafond,
 * la période et le renouvellement vivent chez lui, et il joint `renews_at` à
 * son refus. Le calcul local ne sert QUE de repli quand le refus n'a pas porté
 * la date (échec en cours de lot, réponse tronquée) — deux calculs de période
 * qui dérivent ne cassent rien de visible, ils endorment simplement un
 * courrier un mois de trop.
 */
function deferUntil(renewsAt: string | null): string {
  if (renewsAt) {
    const parsed = new Date(`${renewsAt.slice(0, 10)}T00:00:00Z`);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
}

/** Attente courte après un refus de cadence : le crédit est intact. */
function retryAfterRateLimit(): string {
  return new Date(Date.now() + 5 * 60 * 1000).toISOString();
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

  const runStartedAt = Date.now();
  let claimedTotal = 0;
  let done = 0;
  let failed = 0;
  let deferred = 0;
  // Une rafale refusée (cadence) arrête l'exécution : enchaîner d'autres
  // appels ne ferait qu'aggraver le refus.
  let stop = false;

  while (!stop && Date.now() - runStartedAt < RUN_BUDGET_MS) {
    const { data: jobs, error: claimErr } = await admin.rpc("claim_analysis_jobs", {
      p_limit: JOBS_PER_RUN,
    });
    if (claimErr) {
      console.error("claim_analysis_jobs:", claimErr.message);
      if (claimedTotal === 0) return jsonResponse({ error: claimErr.message }, 500);
      break;
    }

    const claimed = (jobs ?? []) as AnalysisJob[];
    if (claimed.length === 0) break;
    claimedTotal += claimed.length;

    for (const job of claimed) {
      try {
        let outcome: CallOutcome = { ok: true, kind: "ok" };

        // Un courrier SANS pièce (email sans pièce jointe, saisie manuelle) n'a
        // rien à océriser : son texte est dans le corps. `ocr-courier` refuse alors
        // (400 « Aucun document à extraire ») — sans ce saut, un job `full` lancé
        // depuis « Courrier entrant » échouait trois fois puis abandonnait un
        // courrier parfaitement analysable.
        let hasDocuments = true;
        if (job.kind === "full" || job.kind === "ocr") {
          const { count, error: countErr } = await admin
            .from("courier_documents")
            .select("id", { count: "exact", head: true })
            .eq("courier_id", job.courier_id);
          if (countErr) throw new Error(countErr.message);
          hasDocuments = (count ?? 0) > 0;
        }

        if ((job.kind === "full" || job.kind === "ocr") && hasDocuments) {
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

        // Deux reports, DEUX ÉCHÉANCES. Dans les deux cas la tentative est
        // rendue : ni le crédit épuisé ni la rafale ne sont un défaut du job, et
        // sans ce rollback trois passages de cron suffiraient à abandonner
        // définitivement un courrier parfaitement analysable.
        if (outcome.kind === "quota_exceeded" || outcome.kind === "rate_limited") {
          await admin
            .from("courier_analysis_jobs")
            .update({
              status: "pending",
              attempts: Math.max(0, job.attempts - 1),
              scheduled_at: outcome.kind === "quota_exceeded"
                ? deferUntil(outcome.renewsAt)
                : retryAfterRateLimit(),
              last_error: outcome.error,
              started_at: null,
            })
            .eq("id", job.id);
          deferred++;
          if (outcome.kind === "rate_limited") stop = true;
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
  }

  return jsonResponse({
    claimed: claimedTotal,
    done,
    failed,
    deferred,
    requeued: requeued ?? 0,
  });
});
