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

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
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

    // Fetch courier + participants
    const { data: courier, error: cErr } = await admin
      .from("couriers")
      .select("subject, metadata, received_at, courier_participants(role, name, email, first_name, last_name, organization)")
      .eq("id", courierId)
      .eq("organization_id", orgId)
      .single();
    if (cErr || !courier) return jsonResponse({ error: "Courrier introuvable" }, 404);

    const participants = (courier.courier_participants ?? []) as any[];
    const sender = participants.find((p: any) => p.role === "sender");
    const recipient = participants.find((p: any) => p.role === "recipient");

    const senderFirstName = sender?.first_name ?? "";
    const senderLastName = sender?.last_name ?? "";
    const senderFullName = [senderFirstName, senderLastName].filter(Boolean).join(" ").trim()
      || sender?.name || sender?.email || "Expéditeur inconnu";
    const senderOrg = sender?.organization ?? "";

    const recipientName = recipient
      ? [recipient.first_name, recipient.last_name].filter(Boolean).join(" ").trim() || recipient.name || recipient.email || ""
      : "";

    const receivedAt = courier.received_at
      ? new Date(courier.received_at).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" })
      : null;

    const meta = (courier.metadata ?? {}) as Record<string, any>;
    const bodyHtml = meta.body_html ?? meta.body ?? "";
    const bodyText = meta.body_text ?? (bodyHtml ? stripHtml(bodyHtml) : "");

    // Fetch linked action tickets with procedure name
    const { data: tickets } = await admin
      .from("action_tickets")
      .select("description, status, procedure:procedures(name)")
      .eq("courier_id", courierId);

    const ticketsText = (tickets ?? []).length > 0
      ? (tickets ?? []).map((t: any) => {
          const name = t.procedure?.name ?? "Action";
          return `- ${name}${t.description ? ` : ${t.description}` : ""} [${t.status ?? ""}]`;
        }).join("\n")
      : "Aucune action liée.";

    // ⚠️ LE PROMPT SYSTÈME EST DÉSORMAIS AUTOSUFFISANT, et le changement n'est
    // pas cosmétique. Clara envoyait autrefois les seules contraintes de sortie
    // quand l'agent de rédaction était configuré, son ton venant de la console
    // du fournisseur. Clara ne sait plus si l'alias `redaction-reponse` résout
    // chez le Socle : un alias inconnu retombe sur le modèle par défaut, sans
    // refus et sans avertissement. Un prompt qui compterait sur l'agent
    // produirait alors du texte sans ton ni cadre — silencieusement. On écrit
    // donc tout ; si l'agent existe, le rappel est redondant, jamais nuisible.
    const systemPrompt = `Tu es un assistant expert en rédaction de courrier administratif pour une collectivité française.
Contexte : rédaction de la réponse à un courrier entrant.
Ta réponse doit être professionnelle, claire, et adaptée au type de réponse demandé.
Retourne UNIQUEMENT le corps de la lettre en HTML, avec des balises <p>, <strong>, <em>, <ul>, <li> uniquement.
N'inclus pas les coordonnées, la date, l'objet, la formule d'appel ni la formule de politesse finale.`;

    const userPrompt = `Type de réponse : ${responseType}
${additionalInstructions ? `Instructions complémentaires : ${additionalInstructions}` : ""}

Informations sur le courrier initial :
- Expéditeur : ${senderFullName}${senderOrg ? ` (${senderOrg})` : ""}
- Prénom de l'expéditeur : ${senderFirstName || "non renseigné"}
- Nom de l'expéditeur : ${senderLastName || "non renseigné"}
- Destinataire : ${recipientName || "non renseigné"}
- Date de réception : ${receivedAt ?? "non renseignée"}
- Sujet : ${courier.subject ?? "non renseigné"}
- Contenu du courrier :
${bodyText ? bodyText.slice(0, 4000) : "Non disponible"}

Actions liées au dossier :
${ticketsText}

Rédige maintenant le corps de la lettre de réponse.`;

    // Le guichet réserve, appelle et solde : Clara ne compte plus rien.
    const answer = await socleCompletion({
      system: systemPrompt,
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
