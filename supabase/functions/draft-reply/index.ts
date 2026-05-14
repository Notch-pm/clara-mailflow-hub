import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-org-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MISTRAL_CHAT_URL = "https://api.mistral.ai/v1/chat/completions";
const CHAT_MODEL = "mistral-large-latest";

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

    const mistralKey = Deno.env.get("MISTRAL_API_KEY");
    if (!mistralKey) return jsonResponse({ error: "Clé API Mistral manquante" }, 500);

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

    // Build prompt
    const systemPrompt = `Tu es un assistant expert en rédaction de courrier administratif.
Contexte : Rédaction de réponse à un courrier entrant.
Ta réponse doit être professionnelle, claire et adaptée au type de réponse demandé.
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

    const chatResp = await fetch(MISTRAL_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${mistralKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: CHAT_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.4,
        max_tokens: 1500,
      }),
    });

    if (!chatResp.ok) {
      const err = await chatResp.text();
      return jsonResponse({ error: `Erreur Mistral : ${err}` }, 502);
    }

    const chatData = await chatResp.json();
    let draftHtml = chatData.choices?.[0]?.message?.content ?? "";
    // Strip markdown code block if Mistral wraps the output
    draftHtml = draftHtml.replace(/^```(?:html)?\s*/i, "").replace(/\s*```$/i, "").trim();

    return jsonResponse({ html: draftHtml });
  } catch (err: any) {
    return jsonResponse({ error: err.message ?? "Erreur interne" }, 500);
  }
});
