// Écritures d'un dépôt PUBLIC de courrier, partagées par `portal-form` (iframe)
// et `nora-courrier` (courrier libre du site Nora). Client service_role : la RLS
// ne s'applique pas, c'est l'appelant qui a établi le tenant (`organizationId`).
//
// Logique pure (validation, expéditeur, routage) : `portalIntakeLogic.ts`.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.0";
import type { ConsentRecord } from "./consents/catalog.ts";
import { portalSenderParticipant, safeStorageName, type PortalSubmissionFields } from "./portalIntakeLogic.ts";

type Admin = SupabaseClient;

async function initialStateOf(admin: Admin, workflowId: string | null | undefined): Promise<string | null> {
  if (!workflowId) return null;
  const { data } = await admin
    .from("workflow_states")
    .select("id")
    .eq("workflow_id", workflowId)
    .eq("is_initial", true)
    .maybeSingle();
  return (data as { id?: string } | null)?.id ?? null;
}

/**
 * Organisation gestionnaire et état initial d'un dépôt :
 * workflow de l'organisation (miroir Socle) → workflow du service legacy →
 * workflow par défaut du tenant → aucun état.
 */
export async function resolvePortalRouting(
  admin: Admin,
  organizationId: string,
  target: { socleOrganizationId?: string | null; serviceId?: string | null },
): Promise<{ serviceName: string | null; socleOrganizationId: string | null; initialStateId: string | null }> {
  let serviceName: string | null = null;
  let socleOrganizationId: string | null = null;
  let initialStateId: string | null = null;

  if (target.socleOrganizationId) {
    const { data: socleOrg } = await admin
      .from("socle_organizations")
      .select("id, name, workflow_id")
      .eq("id", target.socleOrganizationId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (socleOrg) {
      serviceName = socleOrg.name ?? null;
      socleOrganizationId = socleOrg.id ?? null;
      initialStateId = await initialStateOf(admin, socleOrg.workflow_id);
    }
  } else if (target.serviceId) {
    // Legacy : formulaire encore rattaché à un service (tables gelées)
    const { data: svc } = await admin
      .from("services")
      .select("name, workflow_id")
      .eq("id", target.serviceId)
      .maybeSingle();
    if (svc) {
      serviceName = svc.name ?? null;
      initialStateId = await initialStateOf(admin, svc.workflow_id);
    }
  }

  if (!initialStateId) {
    const { data: defaultWf } = await admin
      .from("workflows")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("is_default", true)
      .maybeSingle();
    initialStateId = await initialStateOf(admin, defaultWf?.id);
  }

  return { serviceName, socleOrganizationId, initialStateId };
}

export interface CreatePortalCourierInput {
  organizationId: string;
  routing: { serviceName: string | null; socleOrganizationId: string | null; initialStateId: string | null };
  fields: PortalSubmissionFields;
  consents: ConsentRecord[];
  receivedAt: string;
  /** Fusionné dans `couriers.metadata` (après `body_text` et `source`). */
  metadata: Record<string, unknown>;
  files: File[];
  /** Préfixe des journaux : `[portal-form]`, `[nora-courrier]`. */
  logTag: string;
}

export type CreatePortalCourierResult =
  | { ok: true; id: string; chrono: string | null }
  | { ok: false; error: { code?: string; message?: string } | null };

/**
 * Crée le courrier entrant `portal`, son expéditeur brut et ses pièces
 * (best-effort). Les consentements forment la trace immuable de CE dépôt
 * (trigger), datée de la réception.
 */
export async function createPortalCourier(admin: Admin, input: CreatePortalCourierInput): Promise<CreatePortalCourierResult> {
  const { organizationId, routing, fields, receivedAt, logTag } = input;

  const { data: courier, error: courierErr } = await admin
    .from("couriers")
    .insert({
      organization_id: organizationId,
      direction: "inbound",
      channel: "portal",
      subject: (fields.subject ?? "").trim().slice(0, 500),
      received_at: receivedAt,
      assigned_service: routing.serviceName,
      socle_organization_id: routing.socleOrganizationId,
      workflow_state_id: routing.initialStateId,
      created_by: null,
      metadata: { body_text: (fields.body ?? "").trim(), source: "portal", ...input.metadata },
      consents: input.consents.map((c) => ({ ...c, collected_at: receivedAt })),
    })
    .select("id, chrono")
    .single();

  if (courierErr || !courier) {
    return { ok: false, error: courierErr ?? null };
  }

  await admin.from("courier_participants").insert({
    organization_id: organizationId,
    courier_id: courier.id,
    ...portalSenderParticipant(fields),
  });

  for (const file of input.files) {
    try {
      const storageKey = `org_${organizationId}/couriers/${courier.id}/${crypto.randomUUID()}-${safeStorageName(file.name)}`;
      const fileBytes = new Uint8Array(await file.arrayBuffer());

      const { error: upErr } = await admin.storage
        .from("clara-documents")
        .upload(storageKey, fileBytes, {
          contentType: file.type || "application/octet-stream",
          upsert: false,
        });

      if (upErr) {
        console.error(`${logTag} Erreur upload`, file.name, upErr);
        continue;
      }

      await admin.from("courier_documents").insert({
        organization_id: organizationId,
        courier_id: courier.id,
        document_type: "attachment",
        storage_key: storageKey,
        file_name: file.name,
        mime_type: file.type || "application/octet-stream",
        file_size: file.size,
      });
    } catch (e) {
      console.error(`${logTag} Exception upload`, file.name, e);
    }
  }

  return { ok: true, id: courier.id, chrono: courier.chrono ?? null };
}
