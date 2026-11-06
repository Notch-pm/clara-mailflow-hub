// Retour d'état des envois papiers réels : Merci Facteur pousse ici les
// événements de ses courriers (imprimé, distribué, NPAI, AR signé).
//
// Appelé par le prestataire, jamais par un utilisateur : `verify_jwt = false`
// (config.toml). L'origine se vérifie par un jeton secret dans l'URL
// (`?token=…`, secret MF_WEBHOOK_TOKEN), comparé à temps constant. Sans le
// secret, tout est refusé. Le prestataire exige une réponse 200 au corps
// court (< 500 caractères) : on répond 200 même pour un courrier inconnu,
// sinon il rejouerait sans fin.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { mfEventLabel, parseMfWebhook, safeEqual } from "../_shared/merciFacteurLogic.ts";

function reply(text: string, status = 200): Response {
  return new Response(text.slice(0, 200), { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

async function readBody(req: Request): Promise<Record<string, unknown>> {
  const type = req.headers.get("content-type") ?? "";
  const raw = await req.text();
  if (type.includes("application/json") || raw.trim().startsWith("{")) {
    try { return JSON.parse(raw) as Record<string, unknown>; } catch { /* formulaire ? */ }
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of new URLSearchParams(raw)) out[k] = v;
  return out;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return reply("method not allowed", 405);

  const expected = Deno.env.get("MF_WEBHOOK_TOKEN");
  const given = new URL(req.url).searchParams.get("token") ?? "";
  if (!expected || !safeEqual(given, expected)) return reply("forbidden", 403);

  let webhook;
  try {
    webhook = parseMfWebhook(await readBody(req));
  } catch {
    webhook = null;
  }
  if (!webhook) return reply("ignored");

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const label = mfEventLabel(webhook.eventType);
  const at = webhook.eventDate ? new Date(webhook.eventDate.replace(" ", "T")) : new Date();
  const atIso = Number.isNaN(at.getTime()) ? new Date().toISOString() : at.toISOString();
  const isReturned = label === "Non distribué (NPAI)";
  let matched = 0;

  for (const item of webhook.items) {
    // L'identifiant entre dans un filtre PostgREST : des chiffres, rien d'autre.
    if (!/^\d{1,20}$/.test(item.envoiId)) continue;
    // Un envoi_id peut en regrouper plusieurs (« 12,13 ») : on cherche les deux formes.
    const { data: rows } = await admin
      .from("postal_sendings")
      .select("id, organization_id, courier_id, requested_by, events, provider_envoi_id")
      .eq("provider", "merci_facteur")
      .or(`provider_envoi_id.eq.${item.envoiId},provider_envoi_id.like.%${item.envoiId}%`)
      .limit(5);
    const sending = (rows ?? []).find((r) => String(r.provider_envoi_id).split(",").includes(item.envoiId));
    if (!sending) continue;
    matched++;

    const entry = { type: webhook.eventType, label, at: atIso, status: item.status, ref_courrier: item.refCourrier };
    const events = Array.isArray(sending.events) ? [...sending.events, entry].slice(-50) : [entry];
    await admin.from("postal_sendings").update({ events, last_event: label, last_event_at: atIso }).eq("id", sending.id);

    const { data: courier } = await admin
      .from("couriers")
      .select("id, chrono, subject, parent_courier_id")
      .eq("id", sending.courier_id)
      .maybeSingle();
    if (!courier) continue;
    const anchorId = courier.parent_courier_id ?? courier.id;
    await admin.from("courier_events").insert({
      organization_id: sending.organization_id,
      courier_id: anchorId,
      event_type: "outbound_postal_event",
      payload: { reply_id: courier.id, label, status: item.status, provider: "merci_facteur" },
      created_by: null,
    } as never);

    if (isReturned && sending.requested_by) {
      await admin.from("notifications").insert({
        organization_id: sending.organization_id,
        user_id: sending.requested_by,
        type: "postal_returned",
        resource_id: anchorId,
        title: `Non distribué : ${[courier.chrono, courier.subject].filter(Boolean).join(" ") || "courrier"}`,
      } as never);
    }
  }

  return reply(`ok ${matched}/${webhook.items.length}`);
});
