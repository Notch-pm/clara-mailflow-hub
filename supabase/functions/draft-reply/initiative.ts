// Mode « initiative » de `draft-reply` : rédiger un courrier que la
// collectivité envoie d'elle-même, à partir de la consigne de l'agent.
// L'appel passe par le guichet IA du Socle (`socleCompletion`), comme la
// réponse : la clé et le compteur de jetons sont au Socle (règle d'or n° 7).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { AGENT_REDACTION, FEATURE_DRAFT, fitMessage, socleCompletion } from "../_shared/socleAi.ts";
import { formatDateFr, splitDraftSubject, stripHtml } from "./logic.ts";
import {
  buildInitiativeUserPrompt,
  INITIATIVE_SYSTEM_PROMPT,
  initiativePromptError,
  type InitiativeLinkedCourier,
} from "./initiativeLogic.ts";

const INITIATIVE_OUTPUT_TOKENS = 1500;

export interface InitiativeRequest {
  outboundId?: string;
  orgId: string;
  prompt?: unknown;
  currentSubject?: string | null;
  /** Le corps tel qu'il est dans l'éditeur, enregistré ou non. */
  currentHtml?: string | null;
}

export type InitiativeResult =
  | { status: 200; body: { html: string; subject: string | null } }
  | { status: 400 | 404; body: { error: string } };

interface OutboundRow {
  id: string;
  subject: string | null;
  channel: string;
  direction: string;
  parent_courier_id: string | null;
  socle_organization_id: string | null;
  courier_participants:
    | { role: string | null; name: string | null; first_name: string | null; last_name: string | null; organization: string | null; socle_contact_id: string | null }[]
    | null;
}

function bodyTextOf(metadata: unknown): string {
  const meta = (metadata ?? {}) as Record<string, unknown>;
  const text = typeof meta.body_text === "string" ? meta.body_text.trim() : "";
  if (text) return text;
  const html = typeof meta.body_html === "string" ? meta.body_html : "";
  return html ? stripHtml(html) : "";
}

export async function draftInitiative(
  admin: SupabaseClient,
  req: InitiativeRequest,
  ctx: {
    userId: string;
    socleOrgId: string;
    civilityOf: (contactId: string | null) => Promise<string | null>;
  },
): Promise<InitiativeResult> {
  const promptError = initiativePromptError(req.prompt);
  if (promptError) return { status: 400, body: { error: promptError } };
  if (!req.outboundId) return { status: 400, body: { error: "Paramètres manquants" } };
  const prompt = (req.prompt as string).trim();

  const { data: outbound, error } = await admin
    .from("couriers")
    .select(
      "id, subject, channel, direction, parent_courier_id, socle_organization_id, " +
        "courier_participants(role, name, first_name, last_name, organization, socle_contact_id)",
    )
    .eq("id", req.outboundId)
    .eq("organization_id", req.orgId)
    .maybeSingle();
  const row = outbound as unknown as OutboundRow | null;
  if (error || !row) return { status: 404, body: { error: "Courrier introuvable" } };
  if (row.direction !== "outbound" || row.parent_courier_id) {
    return { status: 400, body: { error: "Ce mode ne rédige que les courriers à l'initiative de la collectivité." } };
  }

  const recipient = (row.courier_participants ?? []).find((p) => p.role === "recipient") ?? null;

  // Les courriers liés (onglet Liens) : seuls ceux-là, jamais l'historique de
  // l'usager ni les notes internes de sa fiche.
  const { data: relations } = await admin
    .from("courier_relations")
    .select("source_courier_id, target_courier_id")
    .eq("organization_id", req.orgId)
    .or(`source_courier_id.eq.${row.id},target_courier_id.eq.${row.id}`);
  const linkedIds = Array.from(
    new Set(
      ((relations ?? []) as { source_courier_id: string; target_courier_id: string }[]).map((r) =>
        r.source_courier_id === row.id ? r.target_courier_id : r.source_courier_id,
      ),
    ),
  ).slice(0, 3);

  const [orgRes, issuerRes, linkedRes, analysesRes, civility] = await Promise.all([
    admin.from("organizations").select("name").eq("id", req.orgId).maybeSingle(),
    row.socle_organization_id
      ? admin.from("socle_organizations").select("name, address, email, phone").eq("id", row.socle_organization_id).maybeSingle()
      : Promise.resolve({ data: null }),
    linkedIds.length
      ? admin.from("couriers").select("id, chrono, subject, received_at, metadata").eq("organization_id", req.orgId).in("id", linkedIds)
      : Promise.resolve({ data: [] }),
    linkedIds.length
      ? admin.from("courier_analyses").select("courier_id, summary").eq("organization_id", req.orgId).in("courier_id", linkedIds)
      : Promise.resolve({ data: [] }),
    ctx.civilityOf(recipient?.socle_contact_id ?? null),
  ]);

  const issuer = issuerRes.data as { name: string | null; address: string | null; email: string | null; phone: string | null } | null;
  const summaries = new Map(
    ((analysesRes.data ?? []) as { courier_id: string; summary: string | null }[]).map((a) => [a.courier_id, a.summary]),
  );
  const linkedCouriers: InitiativeLinkedCourier[] = (
    (linkedRes.data ?? []) as { id: string; chrono: string | null; subject: string | null; received_at: string | null; metadata: unknown }[]
  ).map((c) => ({
    chrono: c.chrono,
    subject: c.subject,
    receivedAtLabel: formatDateFr(c.received_at),
    summary: summaries.get(c.id) ?? null,
    bodyText: bodyTextOf(c.metadata),
  }));

  const userPrompt = buildInitiativeUserPrompt({
    prompt,
    orgName: (orgRes.data as { name?: string } | null)?.name ?? "",
    issuerName: issuer?.name ?? "",
    issuerContact: issuer,
    recipient: {
      name: recipient?.name ?? null,
      firstName: recipient?.first_name,
      lastName: recipient?.last_name,
      civility,
      organization: recipient?.organization,
      isPerson: !recipient?.organization,
    },
    channel: row.channel === "email" ? "email" : "paper",
    currentSubject: typeof req.currentSubject === "string" ? req.currentSubject : row.subject,
    currentDraftText: typeof req.currentHtml === "string" ? stripHtml(req.currentHtml) : "",
    linkedCouriers,
  });

  const answer = await socleCompletion({
    system: INITIATIVE_SYSTEM_PROMPT,
    messages: [{ role: "user", content: fitMessage(userPrompt) }],
    agent: AGENT_REDACTION,
    maxOutputTokens: INITIATIVE_OUTPUT_TOKENS,
    ctx: {
      socleOrgId: ctx.socleOrgId,
      feature: FEATURE_DRAFT,
      reference: { kind: "courier", id: row.id },
      actorId: ctx.userId,
    },
  });

  // Tracé sans la consigne : elle peut contenir des données personnelles.
  await admin.from("courier_events").insert({
    organization_id: req.orgId,
    courier_id: row.id,
    event_type: "outbound_ai_drafted",
    payload: { reply_id: row.id, prompt_chars: prompt.length },
    created_by: ctx.userId,
  } as never);

  return { status: 200, body: splitDraftSubject(answer) };
}
