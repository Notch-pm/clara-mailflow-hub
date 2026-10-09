// Edge function: nora-courrier
// POST (multipart) — courrier libre déposé par un usager sur le site Nora,
// relayé de serveur à serveur par `portal-api` de Nora.
//
// ── Ce que Nora a déjà vérifié, et ce que Clara revérifie ──
// Nora sert la page seulement si l'organisme a le courrier libre activé au Socle
// (`free_mail.enabled`), tient l'anti-abus (défi de preuve de travail, limiteur
// par IP) et ne transmet que `kind`/`granted` pour les consentements. Clara ne
// fait confiance qu'à la clé : tout le reste est revalidé ici — champs,
// consentements (phrase recomposée avec `organizations.name`), et surtout le
// ROUTAGE, qui part de l'UUID Socle de l'organisme et jamais d'un id Clara.
//
// ── Où atterrit le courrier ──
// Courrier entrant `portal` (`metadata.source = "nora"`), sur l'organisation
// recopiée du Socle, à l'état initial de son workflow, expéditeur brut
// (`socle_contact_id: null` — le rattachement est un geste d'agent), avec une
// analyse IA mise en file : personne n'est devant l'écran pour cliquer
// « Analyser », et c'est elle qui range le courrier sous « À valider » ou
// « À qualifier » dans Courrier entrant.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.45.0";
import { normalizeConsents } from "../_shared/consents/catalog.ts";
import { portalConsentAnswersFromForm } from "../portal-form/logic.ts";
import { createPortalCourier, resolvePortalRouting } from "../_shared/portalIntake.ts";
import {
  distanceToAnchor,
  isUuid,
  PORTAL_BODY_MAX,
  pickTenant,
  portalFieldsFromForm,
  portalSubmissionError,
} from "../_shared/portalIntakeLogic.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const NORA_INTAKE_KEY = Deno.env.get("NORA_INTAKE_KEY") ?? "";

const LOG = "[nora-courrier]";

// Appel de serveur à serveur : aucun navigateur ne parle à cette fonction,
// donc pas de CORS — un preflight reçoit un 405 comme toute autre méthode.
function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

/** Comparaison à temps constant, sur les empreintes (longueurs égales). */
async function keyMatches(presented: string, expected: string): Promise<boolean> {
  if (!expected) return false;
  const [a, b] = await Promise.all([sha256(presented), sha256(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

type Admin = SupabaseClient;

/** Le tenant Clara qui reçoit le courrier d'un organisme du Socle. */
async function resolveTenant(admin: Admin, socleId: string) {
  const { data: rows, error } = await admin
    .from("socle_organizations")
    .select("id, organization_id")
    .eq("socle_id", socleId)
    .eq("status", "active");
  if (error) throw error;
  if (!rows?.length) return { kind: "none" as const };

  const candidates = await Promise.all(
    (rows as { id: string; organization_id: string }[]).map(async (row) => {
      const [{ data: org }, { data: mirror }] = await Promise.all([
        admin.from("organizations").select("socle_org_id").eq("id", row.organization_id).maybeSingle(),
        admin.from("socle_organizations").select("socle_id, socle_parent_id").eq("organization_id", row.organization_id),
      ]);
      const parentOf = new Map<string, string | null>(
        ((mirror ?? []) as { socle_id: string; socle_parent_id: string | null }[]).map((m) => [m.socle_id, m.socle_parent_id]),
      );
      const anchor = (org as { socle_org_id?: string | null } | null)?.socle_org_id ?? null;
      return {
        organizationId: row.organization_id,
        localId: row.id,
        distance: anchor ? distanceToAnchor(socleId, anchor, parentOf) : null,
      };
    }),
  );

  const pick = pickTenant(candidates);
  if (pick.kind !== "one") return pick;
  const chosen = candidates.find((c) => c.organizationId === pick.organizationId)!;
  return { kind: "one" as const, organizationId: chosen.organizationId, socleOrganizationId: chosen.localId };
}

async function findExisting(admin: Admin, organizationId: string, submissionId: string) {
  const { data } = await admin
    .from("couriers")
    .select("id, chrono")
    .eq("organization_id", organizationId)
    .eq("metadata->>nora_submission_id", submissionId)
    .maybeSingle();
  return data as { id: string; chrono: string | null } | null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  const auth = req.headers.get("authorization") ?? "";
  const presented = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!NORA_INTAKE_KEY) {
    console.error(`${LOG} NORA_INTAKE_KEY absent : dépôt refusé`);
    return jsonResponse({ error: "unauthorized" }, 401);
  }
  if (!presented || !(await keyMatches(presented, NORA_INTAKE_KEY))) {
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
    const fields = portalFieldsFromForm((k) => fd.get(k));
    const files = fd.getAll("files").filter((f) => f instanceof File && f.size > 0) as File[];

    if (!isUuid(socleId)) return validation("Organisme destinataire invalide");
    if (!isUuid(submissionId)) return validation("Identifiant de dépôt invalide");
    const invalid = portalSubmissionError(fields, files, { bodyMax: PORTAL_BODY_MAX });
    if (invalid) return validation(invalid);

    // 1. Routage : l'UUID Socle de l'organisme désigne le tenant Clara.
    const tenant = await resolveTenant(admin, socleId);
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

    // 3. Consentements : la phrase consignée est recomposée ici.
    const { data: orgRow } = await admin.from("organizations").select("name").eq("id", organizationId).maybeSingle();
    const consentCheck = normalizeConsents(
      portalConsentAnswersFromForm((k) => fd.get(k) as string | null),
      (orgRow as { name?: string | null } | null)?.name ?? null,
    );
    if (!consentCheck.ok) return validation(consentCheck.message);
    const receivedAt = new Date().toISOString();

    // 4. Courrier, expéditeur, pièces.
    const routing = await resolvePortalRouting(admin, organizationId, {
      socleOrganizationId: tenant.socleOrganizationId,
    });
    const created = await createPortalCourier(admin, {
      organizationId,
      routing,
      fields,
      consents: consentCheck.consents,
      receivedAt,
      metadata: { source: "nora", nora_submission_id: submissionId },
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

    // 5. Trace et analyse IA (best-effort : le courrier est reçu, quoi qu'il arrive).
    const { error: eventErr } = await admin.from("courier_events").insert({
      organization_id: organizationId,
      courier_id: created.id,
      // event_type est un varchar libre : aucun enum à migrer.
      event_type: "portal_received",
      payload: { source: "nora", subject: fields.subject?.trim() ?? "", attachments: files.length },
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
