// Edge function: portal-form
// GET  ?token=xxx  → retourne la config publique du formulaire (nom, description, service)
// POST (multipart) → soumet le formulaire (anonyme) et crée un courrier inbound channel=portal

import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { normalizeConsents } from "../_shared/consents/catalog.ts";
import { portalConsentAnswersFromForm, portalConsentsConfig } from "./logic.ts";
import { createPortalCourier, resolvePortalRouting } from "../_shared/portalIntake.ts";
import { portalFieldsFromForm, portalSubmissionError } from "../_shared/portalIntakeLogic.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-client-info, apikey",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_MAX = 5;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  try {
    // ── GET : config publique du formulaire ──────────────────────────────────
    if (req.method === "GET") {
      const url = new URL(req.url);
      const token = url.searchParams.get("token");
      if (!token) return jsonResponse({ error: "Token manquant" }, 400);

      const { data: form, error } = await admin
        .from("portal_forms")
        .select("name, description, is_active, service_id, organization_id")
        .eq("token", token)
        .maybeSingle();

      if (error || !form) return jsonResponse({ error: "Formulaire introuvable" }, 404);
      if (!form.is_active) return jsonResponse({ error: "Formulaire inactif" }, 410);

      // Résolution du nom de service sans join (évite les problèmes de cache PostgREST)
      let serviceName: string | null = null;
      if (form.service_id) {
        const { data: svc } = await admin
          .from("services")
          .select("name")
          .eq("id", form.service_id)
          .maybeSingle();
        serviceName = (svc as any)?.name ?? null;
      }

      // Les phrases de consentement, composées ICI avec le nom de l'organisation
      // (`organizations.name`, miroir de la racine Socle) : le POST les
      // recompose à l'identique, donc ce qui est affiché est ce qui est consigné.
      const { data: orgRow } = await admin
        .from("organizations")
        .select("name")
        .eq("id", (form as { organization_id?: string | null }).organization_id ?? "")
        .maybeSingle();

      return jsonResponse({
        name: form.name,
        description: (form as any).description ?? null,
        service_name: serviceName,
        consents: portalConsentsConfig((orgRow as { name?: string | null } | null)?.name ?? null),
      });
    }

    // ── POST (multipart/form-data) : soumission anonyme ─────────────────────
    if (req.method === "POST") {
      let fd: FormData;
      try {
        fd = await req.formData();
      } catch {
        return jsonResponse({ error: "Corps de la requête invalide (multipart attendu)" }, 400);
      }

      const token = fd.get("token") as string | null;
      const fields = portalFieldsFromForm((k) => fd.get(k));
      const uploadedFiles = fd.getAll("files").filter((f) => f instanceof File && f.size > 0) as File[];

      if (!token) return jsonResponse({ error: "Token manquant" }, 400);
      const invalid = portalSubmissionError(fields, uploadedFiles);
      if (invalid) return jsonResponse({ error: invalid }, 400);

      // 1. Charger le formulaire (sans join pour fiabilité)
      const { data: form, error: formErr } = await admin
        .from("portal_forms")
        .select("id, organization_id, service_id, socle_organization_id, is_active, allowed_origins")
        .eq("token", token)
        .maybeSingle();

      if (formErr || !form) return jsonResponse({ error: "Formulaire introuvable" }, 404);
      if (!form.is_active) return jsonResponse({ error: "Formulaire inactif" }, 410);

      // 2. Vérifier l'origine si liste blanche configurée
      const origin = req.headers.get("origin") ?? "";
      const allowedOrigins = form.allowed_origins as string[] | null;
      if (allowedOrigins?.length && origin) {
        const originHost = (() => { try { return new URL(origin).hostname; } catch { return ""; } })();
        const allowed = allowedOrigins.some((o) => {
          try { return new URL(o).hostname === originHost; } catch { return o === originHost; }
        });
        if (!allowed) return jsonResponse({ error: "Origine non autorisée" }, 403);
      }

      // 3. Rate limiting
      const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_SECONDS * 1000).toISOString();
      const { count } = await admin
        .from("portal_form_submissions")
        .select("id", { count: "exact", head: true })
        .eq("portal_form_id", form.id)
        .gte("created_at", windowStart);

      if ((count ?? 0) >= RATE_LIMIT_MAX) {
        return jsonResponse({ error: "Trop de soumissions. Réessayez dans quelques instants." }, 429);
      }

      // 3bis. Consentements RGPD : garde serveur. Le navigateur n'envoie que
      // kind + granted ; la phrase consignée est recomposée ici, avec le même
      // nom que celui servi au GET. `traitement` absent ou refusé ⇒ 400 :
      // sans lui, le dépôt n'est pas validable (même règle qu'Iris).
      const { data: orgRow } = await admin
        .from("organizations")
        .select("name")
        .eq("id", form.organization_id)
        .maybeSingle();
      const consentCheck = normalizeConsents(
        portalConsentAnswersFromForm((k) => fd.get(k) as string | null),
        (orgRow as { name?: string | null } | null)?.name ?? null,
      );
      if (!consentCheck.ok) return jsonResponse({ error: consentCheck.message }, 400);
      const receivedAt = new Date().toISOString();

      // 4. Organisation gestionnaire (miroir Socle, prioritaire) ou service
      //    legacy, et état initial du workflow
      const routing = await resolvePortalRouting(admin, form.organization_id, {
        socleOrganizationId: form.socle_organization_id,
        serviceId: form.service_id,
      });

      // 5-7. Courrier, expéditeur brut, pièces jointes (best-effort)
      const created = await createPortalCourier(admin, {
        organizationId: form.organization_id,
        routing,
        fields,
        consents: consentCheck.consents,
        receivedAt,
        metadata: {},
        files: uploadedFiles,
        logTag: "[portal-form]",
      });

      if (!created.ok) {
        console.error("[portal-form] Erreur insert courier", created.error);
        return jsonResponse({ error: "Erreur lors de la création du courrier" }, 500);
      }

      // 8. Enregistrer la soumission (rate-limiting)
      const ipRaw = req.headers.get("x-forwarded-for") ?? req.headers.get("cf-connecting-ip") ?? "";
      const ip = ipRaw.split(",")[0].trim();
      let ipHash: string | null = null;
      if (ip) {
        const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip));
        ipHash = Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
      }

      await admin.from("portal_form_submissions").insert({ portal_form_id: form.id, ip_hash: ipHash });

      // Nettoyage opportuniste (entrées > 1h)
      const cleanupBefore = new Date(Date.now() - 3600 * 1000).toISOString();
      await admin.from("portal_form_submissions").delete()
        .eq("portal_form_id", form.id).lt("created_at", cleanupBefore);

      return jsonResponse({ ok: true });
    }

    return jsonResponse({ error: "Méthode non supportée" }, 405);
  } catch (e) {
    console.error("[portal-form] error", e);
    return jsonResponse({ error: "Erreur interne" }, 500);
  }
});
