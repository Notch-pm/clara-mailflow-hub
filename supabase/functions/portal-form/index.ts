// Edge function: portal-form
// GET  ?token=xxx  → retourne la config publique du formulaire (nom, description, service)
// POST (multipart) → soumet le formulaire (anonyme) et crée un courrier inbound channel=portal

import { createClient } from "npm:@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-client-info, apikey",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_MAX = 5;
const MAX_FILES = 3;
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 Mo

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
        .select("name, description, is_active, service_id")
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

      return jsonResponse({
        name: form.name,
        description: (form as any).description ?? null,
        service_name: serviceName,
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
      const subject = fd.get("subject") as string | null;
      const messageBody = fd.get("body") as string | null;
      const senderCategory = (fd.get("sender_category") as string | null) ?? "citoyen";
      const senderCivilite = fd.get("sender_civilite") as string | null;
      const senderFirstName = fd.get("sender_first_name") as string | null;
      const senderLastName = fd.get("sender_last_name") as string | null;
      const senderEmail = fd.get("sender_email") as string | null;
      const senderPhone = fd.get("sender_phone") as string | null;
      const uploadedFiles = fd.getAll("files").filter((f) => f instanceof File && f.size > 0) as File[];

      if (!token) return jsonResponse({ error: "Token manquant" }, 400);
      if (!subject?.trim()) return jsonResponse({ error: "Sujet obligatoire" }, 400);
      if (!messageBody?.trim()) return jsonResponse({ error: "Message obligatoire" }, 400);
      if (!["citoyen", "entreprise", "association"].includes(senderCategory)) {
        return jsonResponse({ error: "Catégorie invalide" }, 400);
      }
      if (senderCategory === "citoyen" && !senderFirstName?.trim()) {
        return jsonResponse({ error: "Prénom obligatoire" }, 400);
      }
      if (!senderLastName?.trim()) return jsonResponse({ error: "Nom obligatoire" }, 400);
      if (!senderEmail?.trim() && !senderPhone?.trim()) {
        return jsonResponse({ error: "Email ou téléphone obligatoire" }, 400);
      }

      // Validation des fichiers
      if (uploadedFiles.length > MAX_FILES) {
        return jsonResponse({ error: `Maximum ${MAX_FILES} fichiers autorisés` }, 400);
      }
      for (const file of uploadedFiles) {
        if (file.size > MAX_FILE_SIZE) {
          return jsonResponse({ error: `Le fichier "${file.name}" dépasse la limite de 5 Mo` }, 400);
        }
      }

      // 1. Charger le formulaire (sans join pour fiabilité)
      const { data: form, error: formErr } = await admin
        .from("portal_forms")
        .select("id, organization_id, service_id, is_active, allowed_origins")
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

      // 4. Résoudre le service + état initial du workflow
      let serviceName: string | null = null;
      let initialStateId: string | null = null;

      if (form.service_id) {
        const { data: svc } = await admin
          .from("services")
          .select("name, workflow_id")
          .eq("id", form.service_id)
          .maybeSingle();
        if (svc) {
          serviceName = (svc as any).name ?? null;
          const { data: initState } = await admin
            .from("workflow_states")
            .select("id")
            .eq("workflow_id", (svc as any).workflow_id)
            .eq("is_initial", true)
            .maybeSingle();
          initialStateId = (initState as any)?.id ?? null;
        }
      }

      if (!initialStateId) {
        const { data: defaultWf } = await admin
          .from("workflows")
          .select("id")
          .eq("organization_id", form.organization_id)
          .eq("is_default", true)
          .maybeSingle();
        if (defaultWf) {
          const { data: initState } = await admin
            .from("workflow_states")
            .select("id")
            .eq("workflow_id", (defaultWf as any).id)
            .eq("is_initial", true)
            .maybeSingle();
          initialStateId = (initState as any)?.id ?? null;
        }
      }

      // 5. Créer le courrier
      const { data: courier, error: courierErr } = await admin
        .from("couriers")
        .insert({
          organization_id: form.organization_id,
          direction: "inbound",
          channel: "portal",
          subject: subject.trim().slice(0, 500),
          received_at: new Date().toISOString(),
          assigned_service: serviceName,
          workflow_state_id: initialStateId,
          created_by: null,
          metadata: { body_text: messageBody.trim(), source: "portal" },
        })
        .select("id")
        .single();

      if (courierErr || !courier) {
        console.error("[portal-form] Erreur insert courier", courierErr);
        return jsonResponse({ error: "Erreur lors de la création du courrier" }, 500);
      }

      // 6. Créer le participant expéditeur
      const isCitoyen = senderCategory === "citoyen";
      const firstName = isCitoyen ? (senderFirstName?.trim() || null) : null;
      const lastName = senderLastName!.trim();
      const displayName = isCitoyen
        ? [firstName, lastName].filter(Boolean).join(" ")
        : lastName;

      await admin.from("courier_participants").insert({
        organization_id: form.organization_id,
        courier_id: courier.id,
        role: "sender",
        name: displayName,
        first_name: firstName,
        last_name: lastName,
        email: senderEmail?.trim() || null,
        phone: senderPhone?.trim() || null,
        usager_id: null,
        metadata: {
          category: senderCategory,
          ...(isCitoyen && senderCivilite?.trim() ? { civilite: senderCivilite.trim() } : {}),
        },
      });

      // 7. Upload des pièces jointes (best-effort)
      for (const file of uploadedFiles) {
        try {
          const safeName = file.name.replace(/[^\w.\-]+/g, "_");
          const storageKey = `org_${form.organization_id}/couriers/${courier.id}/${crypto.randomUUID()}-${safeName}`;
          const fileBytes = new Uint8Array(await file.arrayBuffer());

          const { error: upErr } = await admin.storage
            .from("clara-documents")
            .upload(storageKey, fileBytes, {
              contentType: file.type || "application/octet-stream",
              upsert: false,
            });

          if (upErr) {
            console.error("[portal-form] Erreur upload", file.name, upErr);
            continue;
          }

          await admin.from("courier_documents").insert({
            organization_id: form.organization_id,
            courier_id: courier.id,
            document_type: "attachment",
            storage_key: storageKey,
            file_name: file.name,
            mime_type: file.type || "application/octet-stream",
            file_size: file.size,
          });
        } catch (e) {
          console.error("[portal-form] Exception upload", file.name, e);
        }
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
