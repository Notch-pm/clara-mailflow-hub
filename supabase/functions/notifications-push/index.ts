// Edge function: notifications-push
//
// Draine la boîte d'envoi PUSH des notifications et expédie les Web Push
// (VAPID) vers les appareils inscrits. Appelée par pg_cron toutes les minutes
// (`trigger_notifications_push()`), qui n'envoie aucun en-tête Authorization :
// d'où `verify_jwt = false` dans supabase/config.toml et l'authentification par
// `x-cron-secret` comparé à `get_cron_secret()`, motif de process-analysis-queue.
//
// POURQUOI CETTE FONCTION. La cloche ne sonne que si Clara est ouverte dans un
// onglet. Un courrier qui arrive à 17 h 50, une action affectée pendant une
// réunion : personne ne l'apprend avant le lendemain. Ici, la même information
// arrive sur le téléphone, application fermée.
//
// POURQUOI UN CRON ET PAS LE DÉCLENCHEUR. Un appel réseau dans la transaction
// métier la ferait traîner, et la ferait échouer quand un service de push
// tousse — on n'annule pas l'arrivée d'un courrier pour autant. La base décide
// à l'insertion (`trg_notifications_push_queue`) quelles lignes sont à pousser ;
// cette fonction n'est que le facteur.
//
// Cycle par notification : `claim_notification_pushes` réclame un lot ET le
// marque 'sending' atomiquement, avec les appareils du destinataire en JSON →
// un envoi par appareil → `decideOutcome` (envoyée dès qu'UN appareil a reçu ;
// 404/410 ⇒ `disable_push_subscription`) → `settle_notification_push`.
//
// ⚠️ CE QUI SORT : `_shared/push/message.ts` — jamais le corps du courrier, son
// analyse, son expéditeur ni ses pièces. Le texte passe chiffré de bout en bout
// (RFC 8291) : le service de push ne le lit pas.
//
// ⚠️ CORS : aucun. Cette fonction n'est jamais appelée depuis un navigateur.

import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { readVapid } from "../_shared/push/config.ts";
import { pushMessage } from "../_shared/push/message.ts";
import { decideOutcome, type DeliveryResult } from "../_shared/push/outcome.ts";
import { sendPush } from "../_shared/push/transport.ts";

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

/** Même variable que les e-mails d'affectation : un seul permalien pour Clara. */
const APP_ORIGIN = (Deno.env.get("APP_ORIGIN") ?? "https://clara.edilumen.fr").replace(/\/+$/, "");
const VAPID = readVapid(Deno.env.toObject());

/** Taille de lot : une exécution par minute ; chaque ligne peut viser
 *  plusieurs appareils, envoyés en parallèle. */
const BATCH = 50;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

async function getCronSecret(): Promise<string> {
  try {
    const { data, error } = await admin.rpc("get_cron_secret");
    if (error) {
      console.error("[push] get_cron_secret:", error.message);
      return "";
    }
    return (data as string) ?? "";
  } catch (e) {
    console.error("[push] get_cron_secret exception:", e);
    return "";
  }
}

interface ClaimedSubscription {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

interface ClaimedRow {
  notification_id: string;
  organization_id: string;
  organization_name: string | null;
  type: string;
  title: string | null;
  resource_id: string | null;
  attempts: number;
  subscriptions: ClaimedSubscription[] | null;
}

async function settle(id: string, ok: boolean, error?: string | null): Promise<void> {
  const { error: e } = await admin.rpc("settle_notification_push", {
    p_id: id,
    p_ok: ok,
    p_error: error ?? undefined,
  });
  if (e) console.error(`[push] settle ${id}: ${e.message}`);
}

async function disable(subscriptionId: string, reason: string): Promise<void> {
  const { error } = await admin.rpc("disable_push_subscription", {
    p_id: subscriptionId,
    p_reason: reason,
  });
  if (error) console.error(`[push] disable ${subscriptionId}: ${error.message}`);
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  // Seule porte d'entrée : le secret du cron. Un secret absent d'un côté ou de
  // l'autre FERME la porte au lieu de l'ouvrir.
  const provided = req.headers.get("x-cron-secret");
  const expected = await getCronSecret();
  if (!provided || !expected || provided !== expected) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  // Sans clés VAPID on ne réclame RIEN : réclamer consommerait les tentatives
  // d'une file qu'on ne peut pas servir, et la file serait `failed` en cinq
  // minutes le jour où les secrets manquent.
  if (!VAPID) {
    console.error("[push] VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT absents ou invalides");
    return jsonResponse({ error: "not_configured" }, 503);
  }

  const { data, error } = await admin.rpc("claim_notification_pushes", { p_limit: BATCH });
  if (error) {
    console.error(`[push] claim: ${error.message}`);
    return jsonResponse({ error: "claim_failed" }, 500);
  }

  const rows = (data ?? []) as ClaimedRow[];
  if (rows.length === 0) return jsonResponse({ claimed: 0, sent: 0, retried: 0, disabled: 0 });

  let sent = 0, retried = 0, disabled = 0;

  for (const row of rows) {
    const message = pushMessage({
      type: row.type,
      title: row.title,
      resourceId: row.resource_id,
      organizationName: row.organization_name,
      appUrl: APP_ORIGIN,
    });
    const body = JSON.stringify({ ...message, id: row.notification_id });
    const targets = row.subscriptions ?? [];

    const results: DeliveryResult[] = await Promise.all(targets.map(async (sub) => {
      const r = await sendPush({ endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth }, body, VAPID);
      return { subscriptionId: sub.id, status: r.status, error: r.error };
    }));

    const outcome = decideOutcome(results);
    for (const id of outcome.disable) {
      const r = results.find((x) => x.subscriptionId === id);
      await disable(id, `HTTP ${r?.status ?? "?"}`);
      disabled++;
    }

    if (outcome.settle === "sent") {
      await settle(row.notification_id, true);
      sent++;
    } else {
      // ⚠️ Jamais l'endpoint ni le texte de la carte dans les journaux :
      // l'identifiant de la notification suffit à retrouver la ligne.
      console.error(`[push] ${row.notification_id} (tentative ${row.attempts}): ${outcome.error}`);
      await settle(row.notification_id, false, outcome.error);
      retried++;
    }
  }

  return jsonResponse({ claimed: rows.length, sent, retried, disabled });
});
