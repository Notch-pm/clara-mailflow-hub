import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { assertEditor } from "../_shared/authz.ts";
import {
  buildHawkHeader,
  extractArray,
  fetchWithHawk,
  resolveArpegeUrl,
  resolveHawkCredentials,
} from "../_shared/arpege.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-org-id, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Main handler ──

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { organization_id, courier_id, procedure_id, demandeur, form_values } = body as {
      organization_id: string;
      courier_id: string;
      procedure_id: string;
      demandeur: Record<string, string>;
      form_values?: Array<{ id: string; valeur: unknown }>;
    };

    if (!organization_id || !courier_id || !procedure_id || !demandeur) {
      return new Response(JSON.stringify({ error: "Paramètres manquants" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Vérifier appartenance organisation
    const { data: membership } = await supabaseAdmin
      .from("organization_users")
      .select("user_id")
      .eq("user_id", user.id)
      .eq("organization_id", organization_id)
      .eq("is_active", true)
      .maybeSingle();
    if (!membership) {
      return new Response(JSON.stringify({ error: "Accès refusé" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Le consultant est en lecture seule : pas de création de demande Arpège.
    if (!(await assertEditor(supabaseAdmin, user.id, organization_id))) {
      return new Response(
        JSON.stringify({ error: "Accès refusé : rôle consultant en lecture seule" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Courrier non orienté ou encore dans la boîte aux lettres : pas d'action.
    // Vérifié AVANT l'appel à Arpège — le trigger de la base refuserait de
    // toute façon le ticket, mais après la création de la demande chez le
    // partenaire, qui resterait orpheline.
    const { data: blockReason, error: guardErr } = await supabaseAdmin.rpc(
      "courier_creation_block_reason",
      { p_courier_id: courier_id },
    );
    if (guardErr) throw guardErr;
    if (blockReason) {
      return new Response(JSON.stringify({ error: blockReason }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Récupérer la procédure et sa config Arpège
    const { data: procedure, error: procErr } = await supabaseAdmin
      .from("procedures")
      .select("external_reference_id, arpege_config_fields, name")
      .eq("id", procedure_id)
      .eq("organization_id", organization_id)
      .eq("external_source", "arpege")
      .single();
    if (procErr || !procedure) {
      return new Response(JSON.stringify({ error: "Procédure Arpège introuvable" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Récupérer les credentials Arpège de l'organisation
    const { data: integration, error: intErr } = await supabaseAdmin
      .from("organization_integrations")
      .select("api_base_url, client_id, client_secret, access_token")
      .eq("organization_id", organization_id)
      .eq("provider", "arpege")
      .eq("is_active", true)
      .maybeSingle();
    if (intErr || !integration?.api_base_url) {
      return new Response(JSON.stringify({ error: "Intégration Arpège non configurée" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { hawkId, hawkKey } = resolveHawkCredentials(integration);
    if (!hawkId || !hawkKey) {
      return new Response(JSON.stringify({ error: "Identifiants Hawk manquants" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const config = procedure.arpege_config_fields as {
      CodeQualificationMetier: string;
      ConfigInfoUsagerObligs: Array<{ Code: string; Obligatoire: boolean }>;
      FormComponents: any[] | null;
    } | null;

    // Construire le Demandeur à partir des champs saisis
    const demandeurPayload: Record<string, any> = {};
    const contact: Record<string, string> = {};

    const fieldMap: Record<string, { target: "demandeur" | "contact"; key: string }> = {
      CIVILITE:          { target: "demandeur", key: "CodeCivilite" },
      NOM_USUEL:         { target: "demandeur", key: "NomUsage" },
      NOM_NAISSANCE:     { target: "demandeur", key: "NomNaissance" },
      PRENOMS:           { target: "demandeur", key: "Prenoms" },
      DATE_NAISSANCE:    { target: "demandeur", key: "DateNaissance" },
      EMAIL:             { target: "contact",   key: "LibEmail" },
      TEL_FIXE:          { target: "contact",   key: "LibNumTel" },
      TEL_MOBILE:        { target: "contact",   key: "LibNumMob" },
    };

    for (const [code, mapping] of Object.entries(fieldMap)) {
      const val = demandeur[code];
      if (!val) continue;
      if (mapping.target === "demandeur") demandeurPayload[mapping.key] = val;
      else contact[mapping.key] = val;
    }
    if (Object.keys(contact).length > 0) demandeurPayload.Contact = contact;

    // Appel API Arpège
    const apiBase = resolveArpegeUrl(integration.api_base_url);
    const url = `${apiBase}/v2/Demandes`;
    const postBody = {
      CodeQualificationMetier: config?.CodeQualificationMetier || "",
      CodeQualificationTypeDemande: procedure.external_reference_id,
      Titre: procedure.name,
      IsModeSuperUsager: true,
      Demandeur: demandeurPayload,
      DonneesMetier: form_values ?? [],
    };

    const payload = JSON.stringify(postBody);
    const contentType = "application/json";
    const hawkHeader = await buildHawkHeader(url, "POST", hawkId, hawkKey, contentType, payload);

    const apiResp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: hawkHeader,
        "Content-Type": contentType,
        Accept: "application/json",
      },
      body: payload,
    });

    const apiText = await apiResp.text();
    if (!apiResp.ok) {
      console.error(`Arpège POST error ${apiResp.status}: ${apiText}`);
      return new Response(
        JSON.stringify({ error: `Erreur Arpège ${apiResp.status}: ${apiText.substring(0, 200)}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const apiData = JSON.parse(apiText);
    if (apiData?.IsSuccess === false) {
      return new Response(
        JSON.stringify({ error: `${apiData.CodErreur}: ${apiData.LibErreur}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const arpegeRef = apiData?.Data?.Ticket || null;

    // Upload des pièces jointes vers Arpège
    const piecesJointes = body.pieces_jointes as Record<string, string[]> | undefined;
    if (arpegeRef && piecesJointes && Object.keys(piecesJointes).length > 0) {
      const uploadUrl = `${apiBase}/v2/Demandes/${arpegeRef}/PiecesJointes`;
      for (const [dataId, docIds] of Object.entries(piecesJointes)) {
        for (const docId of docIds) {
          try {
            const { data: doc } = await supabaseAdmin
              .from("courier_documents")
              .select("storage_key, file_name, mime_type")
              .eq("id", docId)
              .single();
            if (!doc) { console.warn(`PJ: document ${docId} introuvable`); continue; }

            const { data: signedData } = await supabaseAdmin.storage
              .from("clara-documents")
              .createSignedUrl(doc.storage_key, 300);
            if (!signedData?.signedUrl) { console.warn(`PJ: signed URL manquante pour ${docId}`); continue; }

            const fileResp = await fetch(signedData.signedUrl);
            if (!fileResp.ok) { console.warn(`PJ: download échoué ${fileResp.status}`); continue; }
            const fileBlob = await fileResp.blob();

            // Hawk header sans payload hash (multipart)
            const hawkUploadHeader = await buildHawkHeader(uploadUrl, "POST", hawkId, hawkKey);
            const form = new FormData();
            form.append("fichier", fileBlob, doc.file_name ?? "fichier");
            form.append("DataId", dataId);

            const upResp = await fetch(uploadUrl, {
              method: "POST",
              headers: { Authorization: hawkUploadHeader },
              body: form,
            });
            if (!upResp.ok) {
              console.warn(`PJ upload échoué ${upResp.status}: ${await upResp.text()}`);
            } else {
              console.log(`PJ ${doc.file_name} transmise pour demande ${arpegeRef}`);
            }
          } catch (e) {
            console.warn(`PJ upload erreur pour doc ${docId}:`, e);
          }
        }
      }
    }

    // Si la procédure n'a pas encore de FormComponents, récupérer le schéma depuis la demande créée
    if (arpegeRef && !config?.FormComponents) {
      try {
        const schemaData = await fetchWithHawk(
          `${apiBase}/v2/Demandes?scope=data_formulaire&Ticket=${arpegeRef}`,
          hawkId, hawkKey,
        );
        const items = schemaData ? extractArray(schemaData) : [];
        const components = items[0]?.data_formulaire?.Components;
        if (Array.isArray(components) && components.length > 0) {
          const updated = { ...(config || {}), FormComponents: components };
          await supabaseAdmin
            .from("procedures")
            .update({ arpege_config_fields: updated } as never)
            .eq("id", procedure_id);
          console.log(`Stored FormComponents for procedure ${procedure_id}`);
        }
      } catch (e) {
        console.warn("Could not fetch form schema:", e);
      }
    }

    // Créer le ticket interne et stocker la ref Arpège
    const { data: ticket, error: ticketErr } = await supabaseAdmin
      .from("action_tickets")
      .insert({
        organization_id,
        courier_id,
        procedure_id,
        description: body.description || null,
        assignee_id: body.assignee_id || null,
        created_by: user.id,
        arpege_demande_ref: arpegeRef,
        arpege_demande_status: "created",
      })
      .select("*")
      .single();

    if (ticketErr) throw ticketErr;

    return new Response(
      JSON.stringify({ ticket, arpege_ref: arpegeRef }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("create-arpege-demande error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
