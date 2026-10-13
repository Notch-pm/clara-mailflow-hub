import { supabase } from "@/integrations/supabase/client";
import { logEvent } from "./courierEventService";
import { createRelation, deleteRelation } from "./courierRelationService";
import { addressLines, type OutboundChannel } from "@/lib/outbound-channel";
import type { SocleContact } from "./socleContactService";

// Courriers sortants à l'initiative de la collectivité (sans parent).
// La base tient les règles (trigger `couriers_enforce_outbound_initiative`) :
// ce service ne fait que les appeler et journaliser sur le sortant lui-même.

/**
 * Déclare un courrier postal « posté » le jour donné (AAAA-MM-JJ), avec
 * l'exemplaire conservé. La base refuse une date future ou antérieure à la
 * création, une seconde déclaration, un courrier qui n'est pas postal, et
 * fixe elle-même `sent_at` à ce jour.
 */
export async function markOutboundPosted(args: {
  organizationId: string;
  outboundId: string;
  postedOn: string;
  postedBy: string;
  documentId: string | null;
}): Promise<void> {
  const { data: existing, error: fErr } = await supabase
    .from("couriers")
    .select("metadata")
    .eq("id", args.outboundId)
    .eq("organization_id", args.organizationId)
    .single();
  if (fErr) throw fErr;
  const meta = ((existing as { metadata: Record<string, unknown> | null }).metadata) ?? {};
  const { error } = await supabase
    .from("couriers")
    .update({
      metadata: { ...meta, posted_at: args.postedOn, posted_by: args.postedBy, posted_document_id: args.documentId },
    } as never)
    .eq("id", args.outboundId)
    .eq("organization_id", args.organizationId);
  if (error) throw error;
  await logEvent(args.organizationId, args.outboundId, "outbound_posted", {
    reply_id: args.outboundId,
    posted_on: args.postedOn,
  });
  await mirrorOnLinkedInbound(args.organizationId, args.outboundId, "outbound_posted", { posted_on: args.postedOn });
}

interface LinkedSide {
  id: string;
  chrono: string | null;
  subject: string | null;
}

/**
 * Relie un courrier à l'initiative à un courrier reçu (lien « sujet lié »,
 * jamais `parent_courier_id` : ce n'est pas une réponse). Les deux historiques
 * en gardent la trace.
 */
export async function linkOutboundToInbound(args: {
  organizationId: string;
  outbound: LinkedSide;
  inbound: LinkedSide;
  note?: string | null;
}): Promise<void> {
  await createRelation({
    organizationId: args.organizationId,
    sourceCourierId: args.outbound.id,
    targetCourierId: args.inbound.id,
    relationType: "sujet_lie",
    note: args.note ?? null,
    createdVia: "manual",
  });
  await logLinkEvents(args.organizationId, "outbound_linked", args.outbound, args.inbound);
}

/** Retire le lien, trace des deux côtés. */
export async function unlinkOutboundFromInbound(args: {
  organizationId: string;
  relationId: string;
  outbound: LinkedSide;
  inbound: LinkedSide;
}): Promise<void> {
  await deleteRelation(args.relationId);
  await logLinkEvents(args.organizationId, "outbound_unlinked", args.outbound, args.inbound);
}

async function logLinkEvents(
  organizationId: string,
  type: "outbound_linked" | "outbound_unlinked",
  outbound: LinkedSide,
  inbound: LinkedSide,
): Promise<void> {
  await Promise.all([
    logEvent(organizationId, outbound.id, type, {
      reply_id: outbound.id,
      other_id: inbound.id,
      other_chrono: inbound.chrono,
      other_subject: inbound.subject,
    }),
    logEvent(organizationId, inbound.id, type, {
      reply_id: outbound.id,
      other_id: outbound.id,
      other_chrono: outbound.chrono,
      other_subject: outbound.subject,
    }),
  ]);
}

/**
 * Recopie un fait du sortant (parti par courriel, posté) dans l'historique
 * des courriers reçus qui lui sont liés : c'est là que l'agent qui instruit
 * le dossier regarde.
 */
export async function mirrorOnLinkedInbound(
  organizationId: string,
  outboundId: string,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const { data } = await supabase
    .from("courier_relations")
    .select("source_courier_id, target_courier_id")
    .eq("organization_id", organizationId)
    .or(`source_courier_id.eq.${outboundId},target_courier_id.eq.${outboundId}`);
  const others = Array.from(
    new Set(
      ((data ?? []) as { source_courier_id: string; target_courier_id: string }[]).map((r) =>
        r.source_courier_id === outboundId ? r.target_courier_id : r.source_courier_id,
      ),
    ),
  );
  await Promise.all(others.map((id) => logEvent(organizationId, id, eventType, { ...payload, reply_id: outboundId })));
}

/** Instantané d'une fiche du référentiel, tel que le participant le garde. */
export function recipientSnapshot(contact: SocleContact) {
  const lines = addressLines(contact);
  return {
    socle_contact_id: contact.id,
    name: contact.display_name?.trim() || contact.email || null,
    first_name: contact.first_name,
    last_name: contact.last_name,
    organization: contact.contact_type === "personne" ? null : contact.legal_name,
    email: contact.email,
    phone: contact.mobile_phone ?? contact.landline_phone,
    address: lines.length ? lines.join(", ") : null,
    address_line1: contact.address_line1,
    address_line2: contact.address_line2,
    postal_code: contact.postal_code,
    city: contact.city,
  };
}

/**
 * Crée le sortant, son destinataire et l'événement de création en une seule
 * transaction (RPC `create_outbound_courier`). Rend l'identifiant du courrier.
 */
export async function createOutboundCourier(args: {
  organizationId: string;
  socleOrganizationId: string;
  channel: OutboundChannel;
  subject: string;
  recipient: SocleContact;
  /** Confidentiel dès la création (la base vérifie le droit de le poser). */
  confidential?: boolean;
}): Promise<string> {
  const { data, error } = await supabase.rpc("create_outbound_courier", {
    p_organization_id: args.organizationId,
    p_socle_organization_id: args.socleOrganizationId,
    p_channel: args.channel,
    p_subject: args.subject,
    p_recipient: recipientSnapshot(args.recipient),
    ...(args.confidential ? { p_is_confidential: true } : {}),
  });
  if (error) throw error;
  return data as string;
}

/** Remplace le destinataire (fiche du référentiel) tant que rien n'est parti. */
export async function setOutboundRecipient(
  organizationId: string,
  outboundId: string,
  contact: SocleContact,
): Promise<void> {
  const snap = recipientSnapshot(contact);
  const row = {
    socle_contact_id: snap.socle_contact_id,
    name: snap.name,
    first_name: snap.first_name,
    last_name: snap.last_name,
    organization: snap.organization,
    email: snap.email,
    phone: snap.phone,
    address: snap.address,
    metadata: {
      address_line1: snap.address_line1,
      address_line2: snap.address_line2,
      postal_code: snap.postal_code,
      city: snap.city,
    },
  };
  const { data: existing, error: fErr } = await supabase
    .from("courier_participants")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("courier_id", outboundId)
    .eq("role", "recipient")
    .limit(1);
  if (fErr) throw fErr;
  const current = (existing ?? [])[0] as { id: string } | undefined;
  const { error } = current
    ? await supabase.from("courier_participants").update(row as never).eq("id", current.id)
    : await supabase
        .from("courier_participants")
        .insert({ ...row, organization_id: organizationId, courier_id: outboundId, role: "recipient" } as never);
  if (error) throw error;
  await logEvent(organizationId, outboundId, "outbound_recipient_changed", {
    reply_id: outboundId,
    recipient_name: snap.name,
  });
}

/** Courriel ou courrier postal — refusé par la base après visa, signature ou envoi. */
export async function changeOutboundChannel(
  organizationId: string,
  outboundId: string,
  channel: OutboundChannel,
): Promise<void> {
  const { error } = await supabase
    .from("couriers")
    .update({ channel } as never)
    .eq("id", outboundId)
    .eq("organization_id", organizationId);
  if (error) throw error;
  await logEvent(organizationId, outboundId, "outbound_channel_changed", { reply_id: outboundId, channel });
}

/**
 * Change l'organisation émettrice : le courrier repart de l'état initial du
 * workflow de réponse de la nouvelle organisation, sans signataire désigné.
 * La base refuse hors état initial, ou après visa, signature ou envoi.
 */
export async function changeOutboundOrganization(args: {
  organizationId: string;
  outboundId: string;
  socleOrganization: { id: string; name: string };
  initialStateId: string;
  metadata: Record<string, unknown> | null;
}): Promise<void> {
  const nextMeta = { ...(args.metadata ?? {}) };
  delete nextMeta.signatory_id;
  delete nextMeta.visa_viseurs;
  const { error } = await supabase
    .from("couriers")
    .update({
      socle_organization_id: args.socleOrganization.id,
      assigned_service: args.socleOrganization.name,
      workflow_state_id: args.initialStateId,
      metadata: nextMeta,
    } as never)
    .eq("id", args.outboundId)
    .eq("organization_id", args.organizationId);
  if (error) throw error;
  await logEvent(args.organizationId, args.outboundId, "outbound_org_changed", {
    reply_id: args.outboundId,
    to: args.socleOrganization.name,
  });
}

/**
 * Un sortant créé avant les courriers à l'initiative n'a ni organisation ni
 * état : on lui affecte son organisation émettrice et, d'un même geste,
 * l'état initial du workflow de réponse de celle-ci.
 */
export async function assignShellOrganization(args: {
  organizationId: string;
  outboundId: string;
  socleOrganization: { id: string; name: string };
  initialStateId: string;
}): Promise<void> {
  const { error } = await supabase
    .from("couriers")
    .update({
      socle_organization_id: args.socleOrganization.id,
      assigned_service: args.socleOrganization.name,
      workflow_state_id: args.initialStateId,
    } as never)
    .eq("id", args.outboundId)
    .eq("organization_id", args.organizationId);
  if (error) throw error;
  await logEvent(args.organizationId, args.outboundId, "outbound_org_changed", {
    reply_id: args.outboundId,
    to: args.socleOrganization.name,
  });
}
