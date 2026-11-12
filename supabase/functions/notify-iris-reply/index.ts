// Edge function: notify-iris-reply
// Draine la file `iris_reply_notifications` (cron chaque minute, `x-cron-secret`).
//
// Un courrier de réponse déposé par Iris (`iris-reply-courier`) est PARTI ou a
// été ABANDONNÉ : le trigger `couriers_enqueue_iris_reply_notification` a mis un
// avis en file. On le livre à Iris — `POST /v1/requests/{id}/reply-letter/events`
// (contrat Iris 2.12.0, scope `requests:reply_letter`) avec la clé plateforme
// de la collectivité (`resolveIrisIntegration`). Iris clôt alors la demande avec
// l'issue choisie par son agent, ou la rend à l'instruction.
//
// Livraison « au moins une fois » : Iris rend 200 sur un rejeu. Un refus
// définitif (404, 409…) n'est pas relancé (`rejected`) ; une panne l'est, avec
// un délai croissant, jusqu'à `IRIS_NOTIFY_MAX_ATTEMPTS` (`failed`).

import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { postIrisReplyLetterEvent, resolveIrisIntegration } from "../_shared/iris.ts";
import {
  IRIS_NOTIFY_MAX_ATTEMPTS,
  irisNotifyBackoffMinutes,
  irisNotifyOutcome,
  irisReplyEventBody,
  type IrisReplyEvent,
} from "../_shared/irisReplyLogic.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const LOG = "[notify-iris-reply]";
const BATCH = 20;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function getCronSecret(): Promise<string> {
  try {
    const { data, error } = await admin.rpc("get_cron_secret");
    if (error) {
      console.error(`${LOG} get_cron_secret:`, error.message);
      return "";
    }
    return (data as string) ?? "";
  } catch (e) {
    console.error(`${LOG} get_cron_secret exception:`, e);
    return "";
  }
}

interface NotificationRow {
  id: string;
  organization_id: string;
  courier_id: string;
  iris_request_id: string;
  event: IrisReplyEvent;
  occurred_at: string;
  attempts: number;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  // Seule porte : le secret du cron. Un secret absent FERME la porte.
  const provided = req.headers.get("x-cron-secret");
  const expected = await getCronSecret();
  if (!provided || !expected || provided !== expected) return jsonResponse({ error: "Unauthorized" }, 401);

  const { data, error } = await admin.rpc("claim_iris_reply_notifications", { p_limit: BATCH });
  if (error) {
    console.error(`${LOG} claim:`, error.message);
    return jsonResponse({ error: "claim_failed" }, 500);
  }

  const counts = { delivered: 0, rejected: 0, retry: 0, failed: 0 };
  for (const row of (data ?? []) as NotificationRow[]) {
    let status: number | null = null;
    let detail: string | null = null;
    const lookup = await resolveIrisIntegration(admin, row.organization_id);
    if (!lookup.integration) {
      detail = `Connexion Iris ${lookup.reason}`;
    } else {
      try {
        const res = await postIrisReplyLetterEvent(
          lookup.integration,
          row.iris_request_id,
          irisReplyEventBody(row.courier_id, row.event, row.occurred_at),
        );
        status = res.status;
        const err = (res.body as { error?: { message?: string } } | null)?.error;
        if (err?.message) detail = err.message.slice(0, 500);
      } catch (e) {
        detail = e instanceof Error ? e.message.slice(0, 500) : "Iris injoignable";
      }
    }

    const outcome = irisNotifyOutcome(status);
    if (outcome === "delivered") {
      counts.delivered++;
      await admin.from("iris_reply_notifications").update({
        status: "delivered", delivered_at: new Date().toISOString(), last_http_status: status, last_error: null,
      }).eq("id", row.id);
      await admin.from("courier_events").insert({
        organization_id: row.organization_id,
        courier_id: row.courier_id,
        event_type: row.event === "sent" ? "iris_reply_sent_notified" : "iris_reply_cancelled_notified",
        payload: { iris_request_id: row.iris_request_id },
      });
    } else if (outcome === "rejected" || row.attempts >= IRIS_NOTIFY_MAX_ATTEMPTS) {
      counts[outcome === "rejected" ? "rejected" : "failed"]++;
      console.error(`${LOG} avis ${row.id} abandonné (${status ?? "réseau"}) : ${detail ?? ""}`);
      await admin.from("iris_reply_notifications").update({
        status: outcome === "rejected" ? "rejected" : "failed", last_http_status: status, last_error: detail,
      }).eq("id", row.id);
    } else {
      counts.retry++;
      const next = new Date(Date.now() + irisNotifyBackoffMinutes(row.attempts) * 60_000).toISOString();
      await admin.from("iris_reply_notifications").update({
        next_attempt_at: next, last_http_status: status, last_error: detail,
      }).eq("id", row.id);
    }
  }

  return jsonResponse({ ok: true, ...counts });
});
