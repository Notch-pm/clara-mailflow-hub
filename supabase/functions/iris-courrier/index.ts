// Edge function: iris-courrier
// POST (multipart) — « demande complexe » saisie par un agent d'Iris (gestion
// des demandes d'usagers) et relayée de serveur à serveur par l'edge function
// `relay-courrier-clara` d'Iris.
//
// ── Pourquoi une porte distincte de `nora-courrier` ──
// Le modèle de confiance n'est pas le même : Nora relaie un USAGER anonyme du
// web, Iris un AGENT authentifié qui a identifié l'usager dans le Socle. Une clé
// par appelant (`IRIS_INTAKE_KEY`) : le canal se déduit de la PORTE, jamais
// d'un champ du dépôt — un appelant ne choisit pas son canal.
//
// ── Ce qu'Iris a déjà vérifié, et ce que Clara revérifie ──
// Iris a authentifié l'agent, vérifié qu'il peut créer des demandes pour
// l'organisme désigné, relu la fiche de l'usager dans le Socle et passé chaque
// fichier par sa liste fermée de formats. Clara ne fait confiance qu'à la clé :
// champs, consentements (phrase recomposée avec `organizations.name`) et
// ROUTAGE (UUID Socle de l'organisme) sont revalidés ici.
//
// ── Où atterrit le courrier ──
// Courrier entrant `relaye_agent` (`metadata.source = "iris"`), sur
// l'organisation recopiée du Socle, à l'état initial de son workflow, usager
// RATTACHÉ à sa fiche du Socle quand Iris l'a identifié, agent relais en
// participant `cc`, et analyse IA mise en file — c'est elle qui range le
// courrier sous « À valider » ou « À qualifier » dans Courrier entrant.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.45.0";
import { normalizeConsents } from "../_shared/consents/catalog.ts";
import { bearerOf, keyMatches } from "../_shared/intakeKey.ts";
import { portalConsentAnswersFromForm } from "../portal-form/logic.ts";
import { createPortalCourier, resolvePortalRouting, resolveSocleTenant } from "../_shared/portalIntake.ts";
import { isUuid } from "../_shared/portalIntakeLogic.ts";
import {
  irisAgentParticipant,
  irisFieldsFromForm,
  irisRelayError,
  irisSenderParticipant,
  irisSubject,
} from "../_shared/irisRelayLogic.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const IRIS_INTAKE_KEY = Deno.env.get("IRIS_INTAKE_KEY") ?? "";

const LOG = "[iris-courrier]";

// Appel de serveur à serveur : pas de CORS.
function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type Admin = SupabaseClient;

async function findExisting(admin: Admin, organizationId: string, submissionId: string) {
  const { data } = await admin
    .from("couriers")
    .select("id, chrono")
    .eq("organization_id", organizationId)
    .eq("metadata->>iris_submission_id", submissionId)
    .maybeSingle();
  return data as { id: string; chrono: string | null } | null;
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

  const validation = (message: string) => jsonResponse({ error: "validation", message }, 400);
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  try {
    let fd: FormData;
    try {
      fd = await req.formData();
    } catch {
      return validation("Corps de la requête invalide (multipart attendu)");
    }

    const socleId = fd.get("socle_organization_id");
    const submissionId = fd.get("submission_id");
    const fields = irisFieldsFromForm((k) => fd.get(k));
    const files = fd.getAll("files").filter((f) => f instanceof File && f.size > 0) as File[];

    if (!isUuid(socleId)) return validation("Organisme destinataire invalide");
    if (!isUuid(submissionId)) return validation("Identifiant de dépôt invalide");
    const invalid = irisRelayError(fields, files);
    if (invalid) return validation(invalid);

    // 1. Routage : l'UUID Socle de l'organisme désigne le tenant Clara.
    const tenant = await resolveSocleTenant(admin, socleId);
    if (tenant.kind === "none") return jsonResponse({ error: "organisme_inconnu" }, 404);
    if (tenant.kind === "ambiguous") {
      console.error(`${LOG} organisme ${socleId} recopié à égale distance par`, tenant.organizationIds);
      return jsonResponse({ error: "organisme_ambigu" }, 409);
    }
    const organizationId = tenant.organizationId;

    // 2. Idempotence : un rejeu (réseau, double clic) rend le même courrier.
    const existing = await findExisting(admin, organizationId, submissionId);
    if (existing) {
      return jsonResponse({ ok: true, courier_id: existing.id, reference: existing.chrono, duplicate: true });
    }

    // 3. Consentements de l'usager, recueillis par l'agent : phrase recomposée ici.
    const { data: orgRow } = await admin.from("organizations").select("name").eq("id", organizationId).maybeSingle();
    const consentCheck = normalizeConsents(
      portalConsentAnswersFromForm((k) => fd.get(k) as string | null),
      (orgRow as { name?: string | null } | null)?.name ?? null,
    );
    if (!consentCheck.ok) return validation(consentCheck.message);
    const receivedAt = new Date().toISOString();
    const subject = irisSubject(fields);

    // 4. Courrier, usager, pièces.
    const routing = await resolvePortalRouting(admin, organizationId, {
      socleOrganizationId: tenant.socleOrganizationId,
    });
    const created = await createPortalCourier(admin, {
      organizationId,
      routing,
      fields: {
        subject,
        body: fields.body ?? "",
        senderCategory: null,
        senderCivilite: null,
        senderFirstName: null,
        senderLastName: null,
        senderEmail: null,
        senderPhone: null,
      },
      consents: consentCheck.consents,
      receivedAt,
      channel: "relaye_agent",
      sender: irisSenderParticipant(fields),
      metadata: { source: "iris", iris_submission_id: submissionId },
      files,
      logTag: LOG,
    });

    if (!created.ok) {
      // Course entre deux rejeux simultanés : l'index unique a tranché.
      if (created.error?.code === "23505") {
        const winner = await findExisting(admin, organizationId, submissionId);
        if (winner) return jsonResponse({ ok: true, courier_id: winner.id, reference: winner.chrono, duplicate: true });
      }
      console.error(`${LOG} Erreur insert courier`, created.error);
      return jsonResponse({ error: "internal" }, 500);
    }

    // 5. Agent relais, trace et analyse IA (best-effort : le courrier est reçu).
    const { error: ccErr } = await admin.from("courier_participants").insert({
      organization_id: organizationId,
      courier_id: created.id,
      ...irisAgentParticipant(fields),
    });
    if (ccErr) console.error(`${LOG} Agent relais`, ccErr.message);

    const { error: eventErr } = await admin.from("courier_events").insert({
      organization_id: organizationId,
      courier_id: created.id,
      // event_type est un varchar libre : aucun enum à migrer.
      event_type: "agent_relay_received",
      payload: { source: "iris", subject, attachments: files.length, relayed_by: fields.relayedByName },
    });
    if (eventErr) console.error(`${LOG} Événement`, eventErr.message);

    const { error: jobErr } = await admin.from("courier_analysis_jobs").insert({
      organization_id: organizationId,
      courier_id: created.id,
      kind: "full",
    });
    if (jobErr && !jobErr.message.includes("duplicate key")) {
      console.error(`${LOG} Enfilement analyse`, jobErr.message);
    }

    return jsonResponse({ ok: true, courier_id: created.id, reference: created.chrono });
  } catch (e) {
    console.error(`${LOG} error`, e);
    return jsonResponse({ error: "internal" }, 500);
  }
});
