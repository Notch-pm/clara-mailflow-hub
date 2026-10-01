// « Améliorer mon message » — relecture de la réponse qu'un agent rédige à un
// courrier : la langue, jamais le sens. Voir `_shared/improveMessage.ts`.
//
// Entrée : `{ courierId, orgId, html, subject? }` (le corps et l'objet en cours
// d'édition, pas forcément enregistrés). Sortie : `{ html, subject }`, ou une
// erreur en français. L'objet voyage dans le message (`withSubject`) : mêmes
// masquage et contrôle que le corps.
// Rien n'est écrit en base : le texte revient à l'éditeur, l'agent le relit,
// peut l'annuler, et c'est « Enregistrer » qui l'enregistre.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import {
  AGENT_CORRECTION,
  AiQuotaExceededError,
  FEATURE_CORRECTION,
  isAiConfigured,
  SocleAiError,
  socleCompletion,
  socleOrgIdFor,
} from "../_shared/socleAi.ts";
import { assertEditor } from "../_shared/authz.ts";
import {
  buildImproveUserMessage,
  cleanImproveOutput,
  identityTerms,
  IMPROVE_SYSTEM_PROMPT,
  improveOutputTokens,
  maskMessage,
  splitSubject,
  withSubject,
  MAX_IMPROVE_CHARS,
  MAX_IMPROVE_HTML_CHARS,
  unmaskMessage,
  visibleText,
} from "../_shared/improveMessage.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-org-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface ParticipantRow {
  name: string | null;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  organization: string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const authHeader = req.headers.get("authorization");
    if (!authHeader) return jsonResponse({ error: "Non autorisé" }, 401);
    const anon = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { auth: { persistSession: false } });
    const { data: auth, error: authErr } = await anon.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authErr || !auth.user) return jsonResponse({ error: "Non autorisé" }, 401);
    const user = auth.user;
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

    const { courierId, orgId, html, subject } = await req.json().catch(() => ({})) as {
      courierId?: string;
      orgId?: string;
      html?: unknown;
      subject?: unknown;
    };
    if (!courierId || !orgId) return jsonResponse({ error: "Paramètres manquants" }, 400);
    if (typeof html !== "string" || visibleText(html) === "") {
      return jsonResponse({ error: "Rien à améliorer : le message est vide." }, 400);
    }
    if (html.length > MAX_IMPROVE_HTML_CHARS) {
      return jsonResponse({ error: "Le message est trop long pour être amélioré d'un coup." }, 400);
    }

    const { data: membership } = await admin
      .from("organization_users")
      .select("user_id")
      .eq("user_id", user.id)
      .eq("organization_id", orgId)
      .eq("is_active", true)
      .maybeSingle();
    if (!membership) return jsonResponse({ error: "Accès refusé" }, 403);

    // Le consultant est en lecture seule : il ne rédige pas de réponse.
    if (!(await assertEditor(admin, user.id, orgId))) {
      return jsonResponse({ error: "Accès refusé : rôle consultant en lecture seule" }, 403);
    }

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

    // Identités connues du courrier : masquées dans le texte, jamais envoyées.
    const { data: courier } = await admin
      .from("couriers")
      .select("id, courier_participants(name, email, first_name, last_name, organization)")
      .eq("id", courierId)
      .eq("organization_id", orgId)
      .maybeSingle();
    if (!courier) return jsonResponse({ error: "Courrier introuvable" }, 404);
    const participants = ((courier as { courier_participants?: ParticipantRow[] | null }).courier_participants) ?? [];
    const terms = identityTerms(
      participants.flatMap((p) => [p.name, p.email, p.first_name, p.last_name, p.organization]),
    );

    const subjectIn = typeof subject === "string" ? subject.trim() : "";
    const masked = maskMessage(withSubject(html, subjectIn), terms);
    if (masked.text.length > MAX_IMPROVE_CHARS) {
      return jsonResponse(
        { error: `Le message est trop long pour être amélioré d'un coup (${MAX_IMPROVE_CHARS} caractères environ au plus).` },
        400,
      );
    }

    const answer = await socleCompletion({
      system: IMPROVE_SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildImproveUserMessage(masked.text, { hasSubject: !!subjectIn }) }],
      agent: AGENT_CORRECTION,
      maxOutputTokens: improveOutputTokens(masked.text),
      ctx: {
        socleOrgId,
        feature: FEATURE_CORRECTION,
        reference: { kind: "courier", id: courierId },
        actorId: user.id,
      },
    });

    const result = unmaskMessage(cleanImproveOutput(answer), masked);
    if (!result.ok) {
      // On ne rend JAMAIS un texte qui aurait perdu une donnée ou une mise en
      // forme de l'agent. Le motif reste au journal, pas le texte.
      console.error(`[improve-reply] résultat refusé (${result.reason}) pour le courrier ${courierId}`);
      return jsonResponse(
        { error: "L'amélioration proposée n'a pas conservé tout votre texte : elle n'a pas été appliquée. Réessayez." },
        502,
      );
    }
    if (!subjectIn) return jsonResponse({ html: result.html, subject: null });
    const split = splitSubject(result.html);
    // Un objet vidé par le modèle ne remplace rien : on garde celui de l'agent.
    return jsonResponse({ html: split.html, subject: split.subject ?? subjectIn });
  } catch (err) {
    if (err instanceof SocleAiError) {
      return jsonResponse({
        error: err.message,
        code: err.code,
        renews_at: err instanceof AiQuotaExceededError ? err.renewsAt : null,
      }, err.status);
    }
    const message = err instanceof Error ? err.message : "Erreur interne";
    return jsonResponse({ error: message }, 500);
  }
});
