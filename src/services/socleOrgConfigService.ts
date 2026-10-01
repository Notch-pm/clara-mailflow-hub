import { supabase } from "@/integrations/supabase/client";
import { updateCourier } from "@/services/courierService";
import { logEvent } from "@/services/courierEventService";
import type { SocleOrgMirror } from "@/services/socleSyncService";

// Configuration Clara des (sous-)organisations Socle — remplace orgServiceService
// pour les nouveaux flux (les tables services sont gelées).
// Une organisation porte : workflow courrier reçu, workflow réponse, membres,
// signataires ; sa boîte IMAP est rattachée via imap_settings.socle_organization_id.

export interface SocleOrgWithConfig extends SocleOrgMirror {
  workflow_id: string | null;
  reply_workflow_id: string | null;
  /** Délai souhaité avant accusé de réception, en jours ouvrés — `null` : hérite du parent. */
  sla_ack_business_days: number | null;
  /** Délai souhaité avant résolution, en jours ouvrés — `null` : hérite du parent. */
  sla_resolution_business_days: number | null;
  workflow?: { id: string; name: string } | null;
  reply_workflow?: { id: string; name: string } | null;
  /** Boîtes IMAP rattachées à cette organisation. */
  imap_configs?: { id: string; label: string; username: string }[];
}

/** Organisations du miroir avec leur config Clara (workflows résolus + boîtes IMAP). */
export async function listOrgsWithConfig(orgId: string): Promise<SocleOrgWithConfig[]> {
  const { data, error } = await supabase
    .from("socle_organizations")
    .select("*")
    .eq("organization_id", orgId)
    .order("name", { ascending: true });
  if (error) throw error;

  const orgs = (data ?? []) as unknown as SocleOrgWithConfig[];

  // Résolution manuelle des workflows (pattern listServices — reply_workflow sans jointure auto)
  const wfIds = new Set<string>();
  orgs.forEach((o) => {
    if (o.workflow_id) wfIds.add(o.workflow_id);
    if (o.reply_workflow_id) wfIds.add(o.reply_workflow_id);
  });
  if (wfIds.size > 0) {
    const { data: wfs } = await supabase
      .from("workflows")
      .select("id, name")
      .in("id", Array.from(wfIds));
    const map = new Map((wfs ?? []).map((w) => [w.id, w]));
    orgs.forEach((o) => {
      o.workflow = o.workflow_id ? (map.get(o.workflow_id) ?? null) : null;
      o.reply_workflow = o.reply_workflow_id ? (map.get(o.reply_workflow_id) ?? null) : null;
    });
  }

  // Boîtes IMAP rattachées
  const { data: boxes } = await supabase
    .from("imap_settings")
    .select("id, label, username, socle_organization_id")
    .eq("organization_id", orgId)
    .not("socle_organization_id", "is", null);
  const boxesByOrg = new Map<string, { id: string; label: string; username: string }[]>();
  for (const b of (boxes ?? []) as {
    id: string;
    label: string;
    username: string;
    socle_organization_id: string;
  }[]) {
    const list = boxesByOrg.get(b.socle_organization_id) ?? [];
    list.push({ id: b.id, label: b.label, username: b.username });
    boxesByOrg.set(b.socle_organization_id, list);
  }
  orgs.forEach((o) => {
    o.imap_configs = boxesByOrg.get(o.id) ?? [];
  });

  return orgs;
}

/** Organisations assignables : actives (non obsolètes) uniquement. */
export function assignableOrgs<T extends SocleOrgMirror>(orgs: T[]): T[] {
  return orgs.filter((o) => o.status !== "obsolete" && o.obsoleted_at === null);
}

/** Met à jour la config Clara d'une organisation (jamais les champs Socle). */
export async function updateOrgConfig(
  id: string,
  payload: {
    workflow_id?: string | null;
    reply_workflow_id?: string | null;
    sla_ack_business_days?: number | null;
    sla_resolution_business_days?: number | null;
  },
): Promise<void> {
  const { error } = await supabase
    .from("socle_organizations")
    .update(payload)
    .eq("id", id);
  if (error) throw error;
}

/** Rattache une boîte IMAP à une organisation (ou la détache si socleOrgId = null). */
export async function setImapBoxOrganization(
  imapSettingsId: string,
  socleOrgId: string | null,
): Promise<void> {
  const { error } = await supabase
    .from("imap_settings")
    .update({ socle_organization_id: socleOrgId })
    .eq("id", imapSettingsId);
  if (error) throw error;
}

export async function listOrgMemberIds(socleOrgId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("socle_organization_members")
    .select("user_id")
    .eq("socle_organization_id", socleOrgId);
  if (error) throw error;
  return ((data ?? []) as { user_id: string }[]).map((r) => r.user_id);
}

export async function setOrgMembers(
  organizationId: string,
  socleOrgId: string,
  userIds: string[],
): Promise<void> {
  const existingIds = await listOrgMemberIds(socleOrgId);
  const toAdd = userIds.filter((id) => !existingIds.includes(id));
  const toRemove = existingIds.filter((id) => !userIds.includes(id));

  if (toAdd.length > 0) {
    const { error } = await supabase.from("socle_organization_members").insert(
      toAdd.map((uid) => ({
        organization_id: organizationId,
        socle_organization_id: socleOrgId,
        user_id: uid,
      })),
    );
    if (error) throw error;
  }
  if (toRemove.length > 0) {
    const { error } = await supabase
      .from("socle_organization_members")
      .delete()
      .eq("socle_organization_id", socleOrgId)
      .in("user_id", toRemove);
    if (error) throw error;
  }
}

export async function listOrgSignatoryIds(socleOrgId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("socle_organization_signatories")
    .select("signatory_id")
    .eq("socle_organization_id", socleOrgId);
  if (error) throw error;
  return ((data ?? []) as { signatory_id: string }[]).map((r) => r.signatory_id);
}

export async function setOrgSignatories(
  organizationId: string,
  socleOrgId: string,
  signatoryIds: string[],
): Promise<void> {
  const existingIds = await listOrgSignatoryIds(socleOrgId);
  const toAdd = signatoryIds.filter((id) => !existingIds.includes(id));
  const toRemove = existingIds.filter((id) => !signatoryIds.includes(id));

  if (toAdd.length > 0) {
    const { error } = await supabase.from("socle_organization_signatories").insert(
      toAdd.map((sid) => ({
        organization_id: organizationId,
        socle_organization_id: socleOrgId,
        signatory_id: sid,
      })),
    );
    if (error) throw error;
  }
  if (toRemove.length > 0) {
    const { error } = await supabase
      .from("socle_organization_signatories")
      .delete()
      .eq("socle_organization_id", socleOrgId)
      .in("signatory_id", toRemove);
    if (error) throw error;
  }
}

/** Vue inverse : organisations associées, par signataire, pour tout le tenant. */
export async function listSignatoryOrgAssociations(
  organizationId: string,
): Promise<Map<string, string[]>> {
  const { data, error } = await supabase
    .from("socle_organization_signatories")
    .select("signatory_id, socle_organization_id")
    .eq("organization_id", organizationId);
  if (error) throw error;
  const map = new Map<string, string[]>();
  for (const r of (data ?? []) as { signatory_id: string; socle_organization_id: string }[]) {
    const list = map.get(r.signatory_id) ?? [];
    list.push(r.socle_organization_id);
    map.set(r.signatory_id, list);
  }
  return map;
}

/** Miroir de setOrgSignatories côté signataire : remplace ses organisations. */
export async function setSignatoryOrganizations(
  organizationId: string,
  signatoryId: string,
  socleOrgIds: string[],
): Promise<void> {
  const { data, error } = await supabase
    .from("socle_organization_signatories")
    .select("socle_organization_id")
    .eq("signatory_id", signatoryId);
  if (error) throw error;
  const existingIds = ((data ?? []) as { socle_organization_id: string }[]).map(
    (r) => r.socle_organization_id,
  );
  const toAdd = socleOrgIds.filter((id) => !existingIds.includes(id));
  const toRemove = existingIds.filter((id) => !socleOrgIds.includes(id));

  if (toAdd.length > 0) {
    const { error: insErr } = await supabase.from("socle_organization_signatories").insert(
      toAdd.map((oid) => ({
        organization_id: organizationId,
        socle_organization_id: oid,
        signatory_id: signatoryId,
      })),
    );
    if (insErr) throw insErr;
  }
  if (toRemove.length > 0) {
    const { error: delErr } = await supabase
      .from("socle_organization_signatories")
      .delete()
      .eq("signatory_id", signatoryId)
      .in("socle_organization_id", toRemove);
    if (delErr) throw delErr;
  }
}

/**
 * Assigne une organisation gestionnaire à un courrier : double écriture
 * (assigned_service = nom de l'org pour stats/recherche/filtres + socle_organization_id),
 * place le courrier dans l'état initial du workflow de l'org et journalise.
 * Types d'événements conservés (service_changed…) pour la compat de la timeline.
 */
export async function assignOrganization(
  organizationId: string,
  courier: { id: string; assigned_service: string | null; metadata: unknown },
  org: SocleOrgWithConfig,
): Promise<{ name: string; initialStateId: string | null }> {
  let initial: { id: string; name: string; category: string } | null = null;
  if (org.workflow_id) {
    const { data, error: stateErr } = await supabase
      .from("workflow_states")
      .select("id, name, category")
      .eq("workflow_id", org.workflow_id)
      .eq("is_initial", true)
      .maybeSingle();
    if (stateErr) throw stateErr;
    initial = data as typeof initial;
  }

  const previous = courier.assigned_service ?? null;
  const currentMeta = (courier.metadata as Record<string, unknown> | null) ?? {};
  const { error } = await updateCourier(organizationId, courier.id, {
    assigned_service: org.name,
    socle_organization_id: org.id,
    workflow_state_id: initial?.id ?? null,
    metadata: { ...currentMeta, socle_organization_id: org.id },
  });
  if (error) throw error;

  await logEvent(organizationId, courier.id, "service_changed", {
    from: previous,
    to: org.name,
  });

  if (initial?.category === "processing") {
    await logEvent(organizationId, courier.id, "instruction_started", {
      state_name: initial.name,
    });
  }

  return { name: org.name, initialStateId: initial?.id ?? null };
}
