import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import {
  AGENT_REDACTION,
  AiQuotaExceededError,
  FEATURE_DRAFT,
  fitMessage,
  isAiConfigured,
  SocleAiError,
  socleCompletion,
  socleOrgIdFor,
} from "../_shared/socleAi.ts";
import { assertEditor } from "../_shared/authz.ts";
import {
  buildDraftUserPrompt,
  type DraftAttachment,
  DRAFT_SYSTEM_PROMPT,
  type DraftPreviousReply,
  type DraftTicket,
  formatDateFr,
  stripHtml,
} from "./logic.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-org-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/**
 * Budget de sortie d'une lettre : le corps seul, sans en-tête ni formule.
 *
 * Volontairement SOUS le plafond du guichet (2000), contrairement aux appels
 * JSON de l'analyse : ici une sortie tronquée dégrade sans casser — l'agent
 * reçoit une lettre un peu courte, qu'il édite, là où un JSON tronqué ne parse
 * pas et fait perdre l'appel entier.
 */
const DRAFT_OUTPUT_TOKENS = 1500;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getAdminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function verifyAuth(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) throw new Error("Unauthorized");
  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const anonClient = createClient(url, anonKey, { auth: { persistSession: false } });
  const token = authHeader.replace("Bearer ", "");
  const { data, error } = await anonClient.auth.getUser(token);
  if (error || !data.user) throw new Error("Unauthorized");
  return data.user;
}

/**
 * Formes des lignes lues plus bas. Le client d'administration n'est pas typé
 * par `Database` (il vit côté Deno, hors du type généré) : ces interfaces sont
 * ce qui reste pour que le compilateur voie quelque chose, et pour que le
 * lecteur sache ce que la requête rapporte sans aller la relire.
 */
interface ParticipantRow {
  role: string | null;
  name: string | null;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  organization: string | null;
}

interface CourierRow {
  subject: string | null;
  chrono: string | null;
  metadata: Record<string, unknown> | null;
  received_at: string | null;
  /** Organisation Socle en charge, jointe par `couriers_socle_organization_id_fkey`. */
  assigned_org: { name: string | null } | null;
  courier_participants: ParticipantRow[] | null;
}

interface DocumentRow {
  id: string;
  file_name: string | null;
}

interface ExtractRow {
  document_id: string;
  text: string | null;
}

interface TicketRow {
  title: string | null;
  description: string | null;
  status: string | null;
  iris_reference: string | null;
  procedure: { name: string | null; description: string | null } | null;
}

interface ReplyRow {
  metadata: Record<string, unknown> | null;
}

/** Le corps d'un courrier, que l'expéditeur l'ait écrit en texte ou en HTML. */
function bodyTextOf(metadata: unknown): string {
  const meta = (metadata ?? {}) as Record<string, unknown>;
  const text = typeof meta.body_text === "string" ? meta.body_text.trim() : "";
  if (text) return text;
  const html = typeof meta.body_html === "string"
    ? meta.body_html
    : typeof meta.body === "string"
    ? meta.body
    : "";
  return html ? stripHtml(html) : "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const user = await verifyAuth(req);
    const admin = getAdminClient();

    const { courierId, orgId, responseType, additionalInstructions } = await req.json() as {
      courierId: string;
      orgId: string;
      responseType: string;
      additionalInstructions?: string;
    };

    if (!courierId || !orgId || !responseType) {
      return jsonResponse({ error: "Paramètres manquants" }, 400);
    }

    // Verify the caller is a member of the requested organization
    const { data: membership, error: memErr } = await admin
      .from("organization_users")
      .select("user_id")
      .eq("user_id", user.id)
      .eq("organization_id", orgId)
      .eq("is_active", true)
      .maybeSingle();
    if (memErr || !membership) {
      return jsonResponse({ error: "Accès refusé" }, 403);
    }

    // Le consultant est en lecture seule : pas de rédaction IA de réponse.
    if (!(await assertEditor(admin, user.id, orgId))) {
      return jsonResponse({ error: "Accès refusé : rôle consultant en lecture seule" }, 403);
    }

    // ⚠️ Ce n'est PAS la clé d'un fournisseur — Clara n'en a plus. C'est le
    // raccordement au guichet IA du Socle, qui détient la clé et le crédit.
    if (!isAiConfigured()) {
      return jsonResponse({ error: "L'assistant IA n'est pas configuré sur cette instance." }, 503);
    }
    const socleOrgId = await socleOrgIdFor(admin, orgId);
    if (!socleOrgId) {
      return jsonResponse(
        { error: "Organisation non rattachée au Socle (socle_org_id manquant) — la consommation IA ne serait imputable à personne." },
        503,
      );
    }

    // Fetch courier + participants + service en charge
    const { data: courier, error: cErr } = await admin
      .from("couriers")
      .select(
        "subject, chrono, metadata, received_at, " +
          "assigned_org:socle_organizations(name), " +
          "courier_participants(role, name, email, first_name, last_name, organization)",
      )
      .eq("id", courierId)
      .eq("organization_id", orgId)
      .single();
    if (cErr || !courier) return jsonResponse({ error: "Courrier introuvable" }, 404);

    const courierRow = courier as unknown as CourierRow;
    const participants = courierRow.courier_participants ?? [];
    const sender = participants.find((p) => p.role === "sender");
    const recipient = participants.find((p) => p.role === "recipient");

    const senderFirstName = sender?.first_name ?? "";
    const senderLastName = sender?.last_name ?? "";
    const senderFullName = [senderFirstName, senderLastName].filter(Boolean).join(" ").trim()
      || sender?.name || sender?.email || "Expéditeur inconnu";
    const senderOrg = sender?.organization ?? "";

    const recipientName = recipient
      ? [recipient.first_name, recipient.last_name].filter(Boolean).join(" ").trim() || recipient.name || recipient.email || ""
      : "";

    // ⚠️ TOUT CE QUI FONDE LA LETTRE EST LU EN UNE FOIS. Six allers-retours
    // séquentiels sur une edge function qui attend déjà le guichet (jusqu'à
    // 75 s), c'est une seconde offerte à personne.
    const [orgRes, analysisRes, extractRes, docRes, ticketRes, threadRes] = await Promise.all([
      admin.from("organizations").select("name").eq("id", orgId).maybeSingle(),
      admin.from("courier_analyses")
        .select("summary, intents")
        .eq("courier_id", courierId)
        .eq("organization_id", orgId)
        .maybeSingle(),
      // Le texte des pièces jointes : pour un courrier scanné, c'est LE
      // courrier. `analyze-courier` le lisait déjà ; la rédaction l'ignorait.
      admin.from("courier_document_extracts")
        .select("document_id, text")
        .eq("courier_id", courierId)
        .eq("organization_id", orgId),
      admin.from("courier_documents")
        .select("id, file_name, created_at")
        .eq("courier_id", courierId)
        .eq("organization_id", orgId)
        .order("created_at", { ascending: true }),
      admin.from("action_tickets")
        .select("title, description, status, iris_reference, procedure:procedures(name, description)")
        .eq("courier_id", courierId)
        .eq("organization_id", orgId),
      // Les réponses déjà faites : un « Suivi » rédigé sans elles promet une
      // seconde fois ce qui a déjà été promis, ou le contredit.
      admin.from("couriers")
        .select("metadata, created_at")
        .eq("parent_courier_id", courierId)
        .eq("organization_id", orgId)
        .eq("direction", "outbound")
        .order("created_at", { ascending: true }),
    ]);

    const orgName = (orgRes.data as { name?: string } | null)?.name ?? "";
    const assignedOrgName = courierRow.assigned_org?.name ?? "";

    const analysis = analysisRes.data as { summary?: string | null; intents?: unknown } | null;
    const analysisIntents = Array.isArray(analysis?.intents)
      ? (analysis!.intents as unknown[]).filter((t): t is string => typeof t === "string")
      : [];

    // Le nom de fichier n'est pas décoratif : « facture_2026.pdf » et
    // « courrier_signe.pdf » ne pèsent pas pareil dans une réponse, et le
    // modèle n'a aucun autre moyen de les distinguer.
    const fileNames = new Map<string, string>();
    const documentOrder = new Map<string, number>();
    ((docRes.data ?? []) as DocumentRow[]).forEach((d, i) => {
      if (!d?.id) return;
      fileNames.set(d.id, (d.file_name ?? "").trim());
      documentOrder.set(d.id, i);
    });
    const attachments: DraftAttachment[] = ((extractRes.data ?? []) as ExtractRow[])
      .map((e) => ({
        name: fileNames.get(e.document_id) || "pièce jointe",
        text: (e.text ?? "").trim(),
        order: documentOrder.get(e.document_id) ?? Number.MAX_SAFE_INTEGER,
      }))
      .filter((a) => a.text.length > 0)
      .sort((a, b) => a.order - b.order)
      .map(({ name, text }) => ({ name, text }));

    const tickets: DraftTicket[] = ((ticketRes.data ?? []) as TicketRow[]).map((t) => ({
      procedureName: t.procedure?.name ?? null,
      procedureDescription: t.procedure?.description ?? null,
      title: t.title ?? null,
      description: t.description ?? null,
      status: t.status ?? null,
      irisReference: t.iris_reference ?? null,
    }));

    const previousReplies: DraftPreviousReply[] = ((threadRes.data ?? []) as ReplyRow[])
      .map((r) => {
        const meta = (r.metadata ?? {}) as Record<string, unknown>;
        // Envoyée, signée, ou encore en brouillon : le modèle ne doit pas
        // présenter comme acquis ce qui n'est jamais parti.
        //
        // ⚠️ NI `is_draft` NI `sent_at` NE DISENT LA VÉRITÉ ICI. `is_draft`
        // reste à `true` après l'envoi (personne ne le retourne), et `sent_at`
        // est renseigné DÈS LA CRÉATION pour satisfaire la contrainte
        // `check_dates` des courriers sortants. Seuls `sent_email_at` (posé par
        // `send-courier-reply`) et `signed_at` racontent quelque chose. Une
        // réponse papier signée puis postée n'a aucun marqueur d'expédition :
        // on dit donc « signée le… » sans rien affirmer de son départ.
        const sentAt = formatDateFr(
          typeof meta.sent_email_at === "string" ? meta.sent_email_at : null,
        );
        const signedAt = formatDateFr(
          typeof meta.signed_at === "string" ? meta.signed_at : null,
        );
        const statusLabel = sentAt
          ? `envoyée par courriel le ${sentAt}`
          : signedAt
          ? `signée le ${signedAt}`
          : "brouillon non finalisé";
        return { statusLabel, text: bodyTextOf(r.metadata) };
      })
      .filter((r) => r.text.length > 0);

    const userPrompt = buildDraftUserPrompt({
      responseType,
      additionalInstructions,
      orgName,
      assignedOrgName,
      chrono: courierRow.chrono,
      senderFullName,
      senderFirstName,
      senderLastName,
      senderOrg,
      recipientName,
      receivedAtLabel: formatDateFr(courierRow.received_at),
      subject: courierRow.subject,
      bodyText: bodyTextOf(courierRow.metadata),
      attachments,
      analysisSummary: analysis?.summary ?? null,
      analysisIntents,
      tickets,
      previousReplies,
    });

    // Le guichet réserve, appelle et solde : Clara ne compte plus rien.
    const answer = await socleCompletion({
      system: DRAFT_SYSTEM_PROMPT,
      messages: [{ role: "user", content: fitMessage(userPrompt) }],
      agent: AGENT_REDACTION,
      maxOutputTokens: DRAFT_OUTPUT_TOKENS,
      ctx: {
        socleOrgId,
        feature: FEATURE_DRAFT,
        reference: { kind: "courier", id: courierId },
        actorId: user.id,
      },
    });

    // Certains modèles enrobent la sortie d'une clôture markdown malgré la
    // consigne — le seul écart jamais observé, et il se retire en une ligne.
    const draftHtml = answer.replace(/^```(?:html)?\s*/i, "").replace(/\s*```$/i, "").trim();

    return jsonResponse({ html: draftHtml });
  } catch (err) {
    // Le guichet a déjà traduit ses refus en messages destinés à l'agent :
    // plafond atteint (avec la date de renouvellement, mot pour mot du Socle),
    // cadence dépassée, panne de fournisseur, configuration absente.
    if (err instanceof SocleAiError) {
      return jsonResponse({
        error: err.message,
        code: err.code,
        // La date vient du Socle, jamais recalculée ici : l'appelant (écran ou
        // worker de file) doit pouvoir la relayer sans risquer de la contredire.
        renews_at: err instanceof AiQuotaExceededError ? err.renewsAt : null,
      }, err.status);
    }
    const message = err instanceof Error ? err.message : "Erreur interne";
    return jsonResponse({ error: message }, 500);
  }
});
