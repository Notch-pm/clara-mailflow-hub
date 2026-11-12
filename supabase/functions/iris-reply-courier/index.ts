// Edge function: iris-reply-courier
// POST (JSON) — COURRIER DE RÉPONSE rédigé par un agent d'Iris et déposé de
// serveur à serveur par l'edge `submit-reply-to-clara` d'Iris (2026-11-12).
//
// La démarche exige que ses courriers de réponse passent par le circuit du
// courrier sortant de Clara (Socle `communication_config.replyLetters`,
// contrat 1.46.0). Le courrier naît ici en SORTANT À L'INITIATIVE, à l'état
// initial du workflow de réponse de l'organisation émettrice, lié à la demande
// Iris (`couriers.iris_*`) : il sera visé, signé, envoyé dans Clara. Quand il
// part — ou est abandonné —, `notify-iris-reply` prévient Iris.
//
// ── Confiance ──
// Même clé que la « demande complexe » (`IRIS_INTAKE_KEY`, une clé par
// appelant). Iris a vérifié le droit de clôture de l'agent et que l'usager a
// une fiche du Socle ; Clara ne fait confiance qu'à la clé et revalide champs
// et routage (UUID Socle de l'organisme → tenant Clara).
//
// ── Réponses (lues par `claraReplyOutcome` côté Iris) ──
// 200/201 { ok, courier_id, reference, url, duplicate? } · 400 validation ·
// 401 clé · 404 organisme_inconnu · 409 organisme_ambigu ·
// 422 no_reply_workflow (organisation sans circuit de réponse) · 500.

import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { bearerOf, keyMatches } from "../_shared/intakeKey.ts";
import { resolveSocleTenant } from "../_shared/portalIntake.ts";
import { claraCourierUrl, irisReplyBodyHtml, parseIrisReplyPayload } from "../_shared/irisReplyLogic.ts";
import { contactsApiKeyForOrg, fetchContactsApi } from "../_shared/socleContactsClient.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const IRIS_INTAKE_KEY = Deno.env.get("IRIS_INTAKE_KEY") ?? "";
const APP_ORIGIN = (Deno.env.get("APP_ORIGIN") ?? "https://clara.edilumen.fr").replace(/\/+$/, "");
const LOG = "[iris-reply-courier]";

// Appel de serveur à serveur : pas de CORS.
function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  if (!IRIS_INTAKE_KEY) {
    console.error(`${LOG} IRIS_INTAKE_KEY absent : dépôt refusé`);
    return jsonResponse({ error: "unauthorized" }, 401);
  }
  const presented = bearerOf(req);
  if (!presented || !(await keyMatches(presented, IRIS_INTAKE_KEY))) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  const payload = parseIrisReplyPayload(await req.json().catch(() => null));
  if ("error" in payload) return jsonResponse({ error: "validation", message: payload.error }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  try {
    // 1. Routage : l'UUID Socle de l'organisme émetteur désigne le tenant Clara.
    const tenant = await resolveSocleTenant(admin, payload.socleOrganizationId);
    if (tenant.kind === "none") return jsonResponse({ error: "organisme_inconnu" }, 404);
    if (tenant.kind === "ambiguous") return jsonResponse({ error: "organisme_ambigu" }, 409);
    const organizationId = tenant.organizationId;

    // 2. Idempotence : un rejeu d'Iris (même soumission) rend le même courrier.
    const findExisting = async () => {
      const { data } = await admin
        .from("couriers")
        .select("id, chrono")
        .eq("organization_id", organizationId)
        .eq("iris_reply_key", payload.submissionId)
        .maybeSingle();
      return data as { id: string; chrono: string | null } | null;
    };
    const existing = await findExisting();
    if (existing) {
      return jsonResponse({
        ok: true, courier_id: existing.id, reference: existing.chrono,
        url: claraCourierUrl(APP_ORIGIN, existing.id), duplicate: true,
      });
    }

    // 3. Destinataire : nom et adresse tenus par le référentiel (best-effort —
    //    l'envoi relit de toute façon la fiche par `socle_contact_id`).
    const recipient: Record<string, string | null> = { socle_contact_id: payload.socleContactId };
    try {
      const { data: org } = await admin.from("organizations").select("socle_org_id").eq("id", organizationId).single();
      const socleOrgId = (org?.socle_org_id as string | null) ?? null;
      const key = contactsApiKeyForOrg(socleOrgId);
      if (key) {
        const { body } = await fetchContactsApi(key, {
          method: "GET", path: `/v1/contacts/${payload.socleContactId}`, idempotent: true,
        }, { socleOrgId });
        const c = (body ?? {}) as Record<string, unknown>;
        const s = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
        recipient.first_name = s(c.first_name);
        recipient.last_name = s(c.last_name);
        recipient.email = s(c.email);
        recipient.name = s(c.display_name) ?? s(c.legal_name)
          ?? ([s(c.first_name), s(c.last_name)].filter(Boolean).join(" ") || null);
      }
    } catch (e) {
      console.warn(`${LOG} fiche du référentiel indisponible :`, e);
    }

    // 4. Le courrier sortant.
    const { data: courierId, error } = await admin.rpc("create_outbound_courier_from_iris", {
      p_organization_id: organizationId,
      p_socle_organization_id: tenant.socleOrganizationId,
      p_channel: payload.channel,
      p_subject: payload.subject,
      p_body_html: irisReplyBodyHtml(payload.bodyText),
      p_body_text: payload.bodyText,
      p_recipient: recipient,
      p_iris: {
        reply_key: payload.submissionId,
        request_id: payload.irisRequest.id,
        reference: payload.irisRequest.reference,
        url: payload.irisRequest.url,
        submitted_by_name: payload.submittedBy.name,
      },
    });
    if (error) {
      if (error.code === "23505") {
        const winner = await findExisting();
        if (winner) {
          return jsonResponse({
            ok: true, courier_id: winner.id, reference: winner.chrono,
            url: claraCourierUrl(APP_ORIGIN, winner.id), duplicate: true,
          });
        }
      }
      if (error.code === "P0010") return jsonResponse({ error: "no_reply_workflow", message: error.message }, 422);
      if (error.code === "P0001") return jsonResponse({ error: "validation", message: error.message }, 400);
      console.error(`${LOG} création`, error);
      return jsonResponse({ error: "internal" }, 500);
    }

    const { data: created } = await admin.from("couriers").select("chrono").eq("id", courierId as string).maybeSingle();
    return jsonResponse({
      ok: true,
      courier_id: courierId,
      reference: (created as { chrono?: string | null } | null)?.chrono ?? null,
      url: claraCourierUrl(APP_ORIGIN, courierId as string),
    }, 201);
  } catch (e) {
    console.error(`${LOG} error`, e);
    return jsonResponse({ error: "internal" }, 500);
  }
});
