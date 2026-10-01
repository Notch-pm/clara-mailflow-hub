import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { logEvent } from "@/services/courierEventService";

// Visa des réponses : « j'ai vu, je valide ». La trace (courier_visas) est
// immuable et gardée côté serveur (trigger courier_visas_validate) : seul un
// viseur de l'organisation gestionnaire peut viser, et seulement l'étape de
// visa où se trouve la réponse. Le viseur désigné se range dans
// metadata.visa_viseurs[stateId] (courierReplyService.updateReplyContent).

export type CourierVisaRow = Database["public"]["Tables"]["courier_visas"]["Row"];

export interface VisaPerson {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
}

export interface ReplyVisa extends CourierVisaRow {
  user: VisaPerson | null;
  designated: VisaPerson | null;
}

export function visaPersonName(p: VisaPerson | null | undefined): string {
  if (!p) return "—";
  return [p.first_name, p.last_name].filter(Boolean).join(" ") || p.email || "—";
}

const VISA_SELECT =
  "*, user:users!courier_visas_user_id_fkey(id, first_name, last_name, email), designated:users!courier_visas_designated_user_id_fkey(id, first_name, last_name, email)";

/** Visas d'une ou plusieurs réponses, du plus ancien au plus récent. */
export async function listReplyVisas(organizationId: string, replyIds: string[]): Promise<ReplyVisa[]> {
  if (replyIds.length === 0) return [];
  const { data, error } = await supabase
    .from("courier_visas")
    .select(VISA_SELECT)
    .eq("organization_id", organizationId)
    .in("courier_id", replyIds)
    .order("visa_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as ReplyVisa[];
}

/** Le visa en vigueur pour une étape (null si l'étape reste à viser). */
export function activeVisaFor(visas: ReplyVisa[], replyId: string, stateId: string | null | undefined): ReplyVisa | null {
  if (!stateId) return null;
  return (
    visas.find((v) => v.courier_id === replyId && v.workflow_state_id === stateId && !v.superseded_at) ?? null
  );
}

/**
 * Viseurs pouvant viser les réponses d'une organisation gestionnaire : rattachés
 * à l'organisation ET portant l'attribut viseur (membres actifs).
 */
export async function listOrgViseurs(organizationId: string, socleOrgId: string): Promise<VisaPerson[]> {
  const [{ data: links, error: lErr }, { data: members, error: mErr }] = await Promise.all([
    supabase
      .from("socle_organization_viseurs")
      .select("user_id, users:user_id(id, first_name, last_name, email)")
      .eq("organization_id", organizationId)
      .eq("socle_organization_id", socleOrgId),
    supabase
      .from("organization_users")
      .select("user_id, is_active")
      .eq("organization_id", organizationId)
      .eq("is_viseur", true),
  ]);
  if (lErr) throw lErr;
  if (mErr) throw mErr;
  const viseurIds = new Set(
    ((members ?? []) as { user_id: string; is_active: boolean | null }[])
      .filter((m) => m.is_active !== false)
      .map((m) => m.user_id),
  );
  return ((links ?? []) as unknown as { user_id: string; users: VisaPerson | null }[])
    .filter((l) => viseurIds.has(l.user_id) && l.users)
    .map((l) => l.users as VisaPerson)
    .sort((a, b) => visaPersonName(a).localeCompare(visaPersonName(b), "fr"));
}

/** Vise l'étape courante d'une réponse et le journalise sur le courrier parent. */
export async function grantVisa(args: {
  organizationId: string;
  parentCourierId: string;
  replyId: string;
  stateId: string;
  comment?: string | null;
}): Promise<ReplyVisa> {
  const comment = args.comment?.trim() || null;
  const { data, error } = await supabase
    .from("courier_visas")
    .insert({
      organization_id: args.organizationId,
      courier_id: args.replyId,
      workflow_state_id: args.stateId,
      comment,
    })
    .select(VISA_SELECT)
    .single();
  if (error) throw error;
  const visa = data as unknown as ReplyVisa;

  const designatedIsOther = visa.designated_user_id && visa.designated_user_id !== visa.user_id;
  await logEvent(args.organizationId, args.parentCourierId, "reply_visa_granted", {
    reply_id: args.replyId,
    state_id: args.stateId,
    state_name: visa.state_name,
    user_id: visa.user_id,
    designated_user_id: visa.designated_user_id,
    designated_name: designatedIsOther ? visaPersonName(visa.designated) : null,
    comment,
  });
  return visa;
}

export interface VisaQueueItem {
  id: string;
  parent_courier_id: string | null;
  chrono: string | null;
  subject: string | null;
  state_id: string;
  state_name: string;
  designated_to_me: boolean;
  designated_user_id: string | null;
}

/**
 * Réponses en attente de MON visa : en étape de visa, dans une organisation
 * dont je suis viseur, sans visa en vigueur. Les réponses qui me sont désignées
 * d'abord, puis celles où je peux viser à la place du désigné.
 */
export async function listMyVisaQueue(organizationId: string, userId: string): Promise<VisaQueueItem[]> {
  const [{ data: me }, { data: myOrgs, error: oErr }] = await Promise.all([
    supabase
      .from("organization_users")
      .select("is_viseur")
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("socle_organization_viseurs")
      .select("socle_organization_id")
      .eq("organization_id", organizationId)
      .eq("user_id", userId),
  ]);
  if (oErr) throw oErr;
  if (!(me as { is_viseur?: boolean } | null)?.is_viseur) return [];
  const orgIds = ((myOrgs ?? []) as { socle_organization_id: string }[]).map((o) => o.socle_organization_id);
  if (orgIds.length === 0) return [];

  const { data: states, error: sErr } = await supabase
    .from("workflow_states")
    .select("id, name")
    .eq("organization_id", organizationId)
    .eq("requires_visa", true);
  if (sErr) throw sErr;
  const stateNames = new Map(((states ?? []) as { id: string; name: string }[]).map((s) => [s.id, s.name]));
  if (stateNames.size === 0) return [];

  const { data: replies, error: rErr } = await supabase
    .from("couriers")
    .select("id, parent_courier_id, chrono, subject, workflow_state_id, metadata")
    .eq("organization_id", organizationId)
    .eq("direction", "outbound")
    .is("deleted_at", null)
    .in("workflow_state_id", [...stateNames.keys()])
    .in("socle_organization_id", orgIds);
  if (rErr) throw rErr;
  const rows = (replies ?? []) as {
    id: string;
    parent_courier_id: string | null;
    chrono: string | null;
    subject: string | null;
    workflow_state_id: string;
    metadata: Record<string, unknown> | null;
  }[];
  if (rows.length === 0) return [];

  const visas = await listReplyVisas(organizationId, rows.map((r) => r.id));
  return rows
    .filter((r) => !activeVisaFor(visas, r.id, r.workflow_state_id))
    .map((r) => {
      const designated = (r.metadata?.visa_viseurs as Record<string, string> | undefined)?.[r.workflow_state_id] ?? null;
      return {
        id: r.id,
        parent_courier_id: r.parent_courier_id,
        chrono: r.chrono,
        subject: r.subject,
        state_id: r.workflow_state_id,
        state_name: stateNames.get(r.workflow_state_id) ?? "",
        designated_user_id: designated,
        designated_to_me: designated === userId,
      };
    })
    .sort((a, b) => Number(b.designated_to_me) - Number(a.designated_to_me));
}
