import { supabase } from "@/integrations/supabase/client";

/** Une réponse que j'ai visée ou signée. */
export interface HandledReply {
  replyId: string;
  parentCourierId: string | null;
  title: string;
  chrono: string | null;
  senderName: string | null;
  /** Ma dernière action sur cette réponse. */
  action: "visa" | "signature";
  /** Étape visée, pour un visa. */
  stateName: string | null;
  at: string;
}

function participantName(p: { name: string | null; first_name: string | null; last_name: string | null }): string | null {
  return p.name?.trim() || [p.first_name, p.last_name].filter(Boolean).join(" ").trim() || null;
}

/**
 * Les réponses que j'ai visées ou signées depuis `sinceIso`, la plus récente
 * d'abord. La trace des visas (`courier_visas`, immuable) et la signature
 * (`metadata.signed_by` = ma fiche de signataire) sont les deux sources : on
 * ne relit pas l'historique, qui ne garde pas toujours le signataire.
 */
export async function listMyHandledReplies(
  organizationId: string,
  userId: string,
  signatoryId: string | null,
  sinceIso: string,
): Promise<HandledReply[]> {
  const [{ data: visas, error: vErr }, signedResult] = await Promise.all([
    supabase
      .from("courier_visas")
      .select("courier_id, visa_at, state_name")
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .gte("visa_at", sinceIso),
    signatoryId
      ? supabase
          .from("couriers")
          .select("id, metadata")
          .eq("organization_id", organizationId)
          .eq("direction", "outbound")
          .is("deleted_at", null)
          .eq("metadata->>signed_by", signatoryId)
          .gte("metadata->>signed_at", sinceIso)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (vErr) throw vErr;
  if (signedResult.error) throw signedResult.error;

  const latest = new Map<string, { action: HandledReply["action"]; stateName: string | null; at: string }>();
  const keep = (id: string, entry: { action: HandledReply["action"]; stateName: string | null; at: string }) => {
    const prev = latest.get(id);
    if (!prev || prev.at < entry.at) latest.set(id, entry);
  };
  for (const v of (visas ?? []) as { courier_id: string; visa_at: string; state_name: string }[]) {
    keep(v.courier_id, { action: "visa", stateName: v.state_name || null, at: v.visa_at });
  }
  for (const r of (signedResult.data ?? []) as { id: string; metadata: Record<string, unknown> | null }[]) {
    const at = r.metadata?.signed_at as string | undefined;
    if (at) keep(r.id, { action: "signature", stateName: null, at });
  }
  if (latest.size === 0) return [];

  const { data: replies, error: rErr } = await supabase
    .from("couriers")
    .select("id, parent_courier_id, subject, chrono")
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .in("id", [...latest.keys()]);
  if (rErr) throw rErr;
  const replyRows = (replies ?? []) as {
    id: string;
    parent_courier_id: string | null;
    subject: string | null;
    chrono: string | null;
  }[];

  const parentIds = [...new Set(replyRows.map((r) => r.parent_courier_id).filter(Boolean))] as string[];
  const parentById: Record<
    string,
    { subject: string | null; chrono: string | null; courier_participants: { role: string; name: string | null; first_name: string | null; last_name: string | null }[] }
  > = {};
  if (parentIds.length > 0) {
    const { data: parents, error: pErr } = await supabase
      .from("couriers")
      .select("id, subject, chrono, courier_participants(role, name, first_name, last_name)")
      .eq("organization_id", organizationId)
      .in("id", parentIds);
    if (pErr) throw pErr;
    for (const p of (parents ?? []) as unknown as (typeof parentById[string] & { id: string })[]) parentById[p.id] = p;
  }

  return replyRows
    .map((r) => {
      const parent = r.parent_courier_id ? parentById[r.parent_courier_id] : undefined;
      const sender = parent?.courier_participants?.find((p) => p.role === "sender");
      const entry = latest.get(r.id)!;
      return {
        replyId: r.id,
        parentCourierId: r.parent_courier_id,
        title: parent?.subject || r.subject || "Sans objet",
        chrono: parent?.chrono ?? r.chrono ?? null,
        senderName: sender ? participantName(sender) : null,
        ...entry,
      };
    })
    .sort((a, b) => b.at.localeCompare(a.at));
}
