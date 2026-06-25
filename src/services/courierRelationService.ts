import { supabase } from "@/integrations/supabase/client";

export type CourierRelationType = "relance" | "sujet_lie";
export type CourierRelationOrigin = "manual" | "ai_suggestion";

export interface CourierRelation {
  id: string;
  organization_id: string;
  source_courier_id: string;
  target_courier_id: string;
  relation_type: CourierRelationType;
  note: string | null;
  created_via: CourierRelationOrigin;
  created_by: string | null;
  created_at: string;
}

export interface RelatedCourierSummary {
  id: string;
  subject: string | null;
  chrono: string | null;
  received_at: string | null;
  sent_at: string | null;
  direction: string;
  assigned_service: string | null;
  metadata: Record<string, unknown> | null;
  courier_participants: Array<{
    id: string;
    role: string;
    name: string | null;
    email: string | null;
    usager_id: string | null;
  }>;
}

export interface CourierRelationWithCourier extends CourierRelation {
  /** The "other side" of the relation relative to the courier being viewed. */
  related: RelatedCourierSummary | null;
  /** Direction of the relation from the viewed courier's perspective. */
  direction: "outgoing" | "incoming";
}

export interface AiLinkSuggestion {
  courier_id: string;
  score: number;
  reasons: string[];
}

const RELATED_SELECT =
  "id, subject, chrono, received_at, sent_at, direction, assigned_service, metadata, courier_participants(id, role, name, email, usager_id)";

/**
 * Returns all relations (both sides) for a given courier, joined with the
 * "other side" courier summary so the UI can display it directly.
 */
export async function listRelationsForCourier(
  courierId: string,
): Promise<CourierRelationWithCourier[]> {
  const { data, error } = await supabase
    .from("courier_relations")
    .select("*")
    .or(`source_courier_id.eq.${courierId},target_courier_id.eq.${courierId}`)
    .order("created_at", { ascending: false });
  if (error) throw error;

  const rows = (data ?? []) as CourierRelation[];
  if (rows.length === 0) return [];

  const otherIds = Array.from(
    new Set(
      rows.map((r) =>
        r.source_courier_id === courierId ? r.target_courier_id : r.source_courier_id,
      ),
    ),
  );
  const { data: couriersData, error: cErr } = await supabase
    .from("couriers")
    .select(RELATED_SELECT)
    .in("id", otherIds);
  if (cErr) throw cErr;
  const byId = new Map<string, RelatedCourierSummary>(
    ((couriersData ?? []) as unknown as RelatedCourierSummary[]).map((c) => [c.id, c]),
  );

  return rows.map<CourierRelationWithCourier>((r) => {
    const isOutgoing = r.source_courier_id === courierId;
    const otherId = isOutgoing ? r.target_courier_id : r.source_courier_id;
    return {
      ...r,
      related: byId.get(otherId) ?? null,
      direction: isOutgoing ? "outgoing" : "incoming",
    };
  });
}

export async function createRelation(input: {
  organizationId: string;
  sourceCourierId: string;
  targetCourierId: string;
  relationType: CourierRelationType;
  note?: string | null;
  createdVia?: CourierRelationOrigin;
}): Promise<CourierRelation> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("courier_relations")
    .insert({
      organization_id: input.organizationId,
      source_courier_id: input.sourceCourierId,
      target_courier_id: input.targetCourierId,
      relation_type: input.relationType,
      note: input.note ?? null,
      created_via: input.createdVia ?? "manual",
      created_by: user?.id ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data as CourierRelation;
}

export async function deleteRelation(id: string): Promise<void> {
  const { error } = await supabase.from("courier_relations").delete().eq("id", id);
  if (error) throw error;
}

/** Search couriers by chrono / subject / sender name for manual linking. */
export async function searchCouriersForLinking(
  organizationId: string,
  query: string,
  excludeCourierId: string,
  limit = 20,
): Promise<RelatedCourierSummary[]> {
  const trimmed = query.trim();
  let req = supabase
    .from("couriers")
    .select(RELATED_SELECT)
    .eq("organization_id", organizationId)
    .eq("direction", "inbound")
    .neq("id", excludeCourierId)
    .order("created_at", { ascending: false })
    .limit(limit);


  if (trimmed.length > 0) {
    // Match either subject or chrono. Sender name lookup via participants is
    // covered by a second query below if needed.
    req = req.or(`subject.ilike.%${trimmed}%,chrono.ilike.%${trimmed}%`);
  }
  const { data, error } = await req;
  if (error) throw error;
  return (data ?? []) as unknown as RelatedCourierSummary[];
}

interface SimilarityCandidate {
  courier: RelatedCourierSummary;
  score: number;
  reasons: string[];
}

const SUBJECT_STOPWORDS = new Set([
  "re", "fwd", "tr", "fw", "ref", "objet",
  "le", "la", "les", "un", "une", "des", "de", "du", "et", "ou", "a", "à",
  "au", "aux", "en", "dans", "sur", "sous", "pour", "par", "avec", "sans",
  "que", "qui", "quoi", "dont", "où", "ce", "cet", "cette", "ces", "se",
  "sa", "son", "ses", "mon", "ma", "mes", "ton", "ta", "tes", "votre",
  "vos", "notre", "nos", "leur", "leurs", "est", "sont", "été", "être",
  "avoir", "fait", "faire", "plus", "moins", "très", "tres", "bien",
  "monsieur", "madame", "mr", "mme", "mlle", "objet", "courrier", "demande",
  "the", "and", "for", "from", "your", "you", "our", "with",
]);

function normalizeSubject(subject: string | null | undefined): string {
  if (!subject) return "";
  return subject
    .toLowerCase()
    .replace(/^((re|fwd?|tr)\s*:\s*)+/gi, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

/** Extract significant tokens from a subject line for similarity matching. */
function extractSubjectTokens(subject: string | null | undefined): Set<string> {
  const cleaned = normalizeSubject(subject);
  if (!cleaned) return new Set();
  const tokens = cleaned.split(/[^a-z0-9]+/).filter(
    (t) => t.length >= 4 && !SUBJECT_STOPWORDS.has(t) && !/^\d+$/.test(t),
  );
  return new Set(tokens);
}

/**
 * Computes similarity client-side between the current courier and all other
 * couriers of the same organization in a sliding window.
 *
 * Scoring:
 *  - same sender usager_id  → +50
 *  - same sender email      → +30
 *  - per common subject word→ +12
 *  - very close subject      → +20
 *  - per common tag/keyword → +10
 *  - recency bonus (linear) → up to +5
 *
 * Filtrage : on exige au moins un signal de contenu (tag OU mot d'objet commun).
 */
export async function computeSimilarCouriers(
  organizationId: string,
  courierId: string,
  opts?: { windowDays?: number; limit?: number; minScore?: number; excludeIds?: string[] },
): Promise<SimilarityCandidate[]> {
  const windowDays = opts?.windowDays ?? 180;
  const limit = opts?.limit ?? 10;
  const minScore = opts?.minScore ?? 15;
  const excludeIds = new Set([courierId, ...(opts?.excludeIds ?? [])]);

  const { data: ref, error: refErr } = await supabase
    .from("couriers")
    .select(RELATED_SELECT)
    .eq("id", courierId)
    .single();
  if (refErr) throw refErr;
  const refCourier = ref as unknown as RelatedCourierSummary;

  const refSender = refCourier.courier_participants.find((p) => p.role === "sender");
  const refNormalizedSubject = normalizeSubject(refCourier.subject);
  const refTags = new Set(
    (((refCourier.metadata as Record<string, unknown> | null)?.tags as string[] | undefined) ?? [])
      .map((t) => t.toLowerCase()),
  );
  const refSubjectTokens = extractSubjectTokens(refCourier.subject);

  const sinceIso = new Date(Date.now() - windowDays * 86400 * 1000).toISOString();

  const { data: candidates, error } = await supabase
    .from("couriers")
    .select(RELATED_SELECT)
    .eq("organization_id", organizationId)
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw error;

  const scored: SimilarityCandidate[] = [];
  const now = Date.now();
  for (const cand of (candidates ?? []) as unknown as RelatedCourierSummary[]) {
    if (excludeIds.has(cand.id)) continue;
    let score = 0;
    const reasons: string[] = [];

    const candSender = cand.courier_participants.find((p) => p.role === "sender");
    if (refSender?.usager_id && candSender?.usager_id === refSender.usager_id) {
      score += 50;
      reasons.push("Même usager");
    } else if (
      refSender?.email &&
      candSender?.email &&
      candSender.email.toLowerCase() === refSender.email.toLowerCase()
    ) {
      score += 30;
      reasons.push("Même email expéditeur");
    }

    // Subject token overlap first: the object is the strongest content signal.
    const candSubjectTokens = extractSubjectTokens(cand.subject);
    const commonSubject: string[] = [];
    for (const t of candSubjectTokens) {
      if (refSubjectTokens.has(t)) commonSubject.push(t);
    }
    const candNormalizedSubject = normalizeSubject(cand.subject);
    const sameNormalizedSubject =
      refNormalizedSubject.length > 0 && candNormalizedSubject === refNormalizedSubject;
    if (commonSubject.length > 0) {
      score += commonSubject.length * 12;
      if (sameNormalizedSubject || commonSubject.length >= 2) score += 20;
      reasons.push(
        sameNormalizedSubject
          ? "Même objet"
          : commonSubject.length === 1
          ? `Objet : « ${commonSubject[0]} »`
          : `${commonSubject.length} mots d'objet communs`,
      );
    }

    const candTags = new Set(
      (((cand.metadata as Record<string, unknown> | null)?.tags as string[] | undefined) ?? [])
        .map((t) => t.toLowerCase()),
    );
    const commonTags: string[] = [];
    for (const t of candTags) {
      if (refTags.has(t)) commonTags.push(t);
    }
    if (commonTags.length > 0) {
      score += commonTags.length * 10;
      reasons.push(
        commonTags.length === 1
          ? "1 mot-clé commun"
          : `${commonTags.length} mots-clés communs`,
      );
    }

    // Recency bonus
    const refDate = new Date(cand.received_at ?? cand.sent_at ?? Date.now()).getTime();
    const ageDays = Math.max(0, (now - refDate) / 86400_000);
    const recencyBonus = Math.max(0, 5 * (1 - ageDays / windowDays));
    score += recencyBonus;

    // Filtrage strict :
    //  - exige au moins un signal de contenu (tag OU mot d'objet commun)
    //  - même usager + signal de contenu → seuil bas
    //  - signal de contenu sans même usager → seuil plus élevé
    const sameSender = reasons.includes("Même usager") || reasons.includes("Même email expéditeur");
    const hasContentSignal = commonTags.length > 0 || commonSubject.length > 0;
    if (!hasContentSignal) continue;
    const hasStrongSubjectSignal = sameNormalizedSubject || commonSubject.length >= 2;
    const threshold = sameSender || hasStrongSubjectSignal ? minScore : Math.max(minScore, 30);
    if (score >= threshold) {
      scored.push({ courier: cand, score: Math.round(score), reasons });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}


export function relationLabel(
  rel: CourierRelationWithCourier,
): { title: string; section: "relances" | "sujets_lies" } {
  if (rel.relation_type === "relance") {
    return {
      title: rel.direction === "outgoing" ? "Relance de ce courrier" : "Relancé par",
      section: "relances",
    };
  }
  return { title: "Sujet lié", section: "sujets_lies" };
}
