import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildHawkHeader, resolveArpegeUrl, resolveHawkCredentials } from "../_shared/arpege.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-org-id, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/** Extract the most useful status string from an Arpège demande response item. */
function extractStatus(item: any): string | null {
  const adm = item?.data_administratives ?? item;
  // Try various common field names used across Arpège API versions
  return (
    adm?.LibelleEtatDemande ||
    adm?.EtatDemande ||
    adm?.LibelleEtat ||
    adm?.StatutDemande ||
    adm?.CodeEtatDemande ||
    adm?.Etat ||
    item?.LibelleEtatDemande ||
    item?.EtatDemande ||
    item?.StatutDemande ||
    null
  );
}

// ── Main handler ────────────────────────────────────────────────────────────

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
    const { organization_id, courier_id } = body as { organization_id: string; courier_id: string };

    if (!organization_id || !courier_id) {
      return new Response(JSON.stringify({ error: "organization_id et courier_id requis" }), {
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

    // Récupérer les tickets Arpège du courrier
    const { data: tickets, error: ticketErr } = await supabaseAdmin
      .from("action_tickets")
      .select("id, arpege_demande_ref, arpege_demande_status")
      .eq("courier_id", courier_id)
      .eq("organization_id", organization_id)
      .not("arpege_demande_ref", "is", null);

    if (ticketErr || !tickets?.length) {
      return new Response(
        JSON.stringify({ updated: 0, statuses: {} }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Récupérer les credentials Arpège
    const { data: integration } = await supabaseAdmin
      .from("organization_integrations")
      .select("api_base_url, client_id, client_secret, access_token")
      .eq("organization_id", organization_id)
      .eq("provider", "arpege")
      .eq("is_active", true)
      .maybeSingle();

    if (!integration?.api_base_url) {
      return new Response(
        JSON.stringify({ updated: 0, statuses: {}, error: "Intégration Arpège non configurée" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { hawkId, hawkKey } = resolveHawkCredentials(integration);
    const apiBase = resolveArpegeUrl(integration.api_base_url);

    const statuses: Record<string, string> = {};
    let updated = 0;

    for (const ticket of tickets) {
      const ref = ticket.arpege_demande_ref as string;
      try {
        const url = `${apiBase}/v2/Demandes?scope=data_administratives&Ticket=${encodeURIComponent(ref)}`;
        const authH = await buildHawkHeader(url, "GET", hawkId, hawkKey);
        const resp = await fetch(url, {
          headers: { Authorization: authH, Accept: "application/json" },
        });

        if (!resp.ok) {
          console.warn(`Status check failed for ${ref}: HTTP ${resp.status}`);
          continue;
        }

        const data = await resp.json();
        // Response may be an array or wrapped object
        const items: any[] = Array.isArray(data)
          ? data
          : Array.isArray(data?.Data?.Results) ? data.Data.Results
          : Array.isArray(data?.Data) ? data.Data
          : data ? [data] : [];

        const item = items[0];
        console.log(`Arpège response for ${ref}:`, JSON.stringify(item ?? data).slice(0, 1000));
        const status = extractStatus(item);

        if (status && status !== ticket.arpege_demande_status) {
          await supabaseAdmin
            .from("action_tickets")
            .update({ arpege_demande_status: status })
            .eq("id", ticket.id);
          updated++;
        }

        statuses[ticket.id] = status ?? ticket.arpege_demande_status ?? "created";
      } catch (e) {
        console.warn(`Error checking status for ticket ${ticket.id}:`, e);
      }
    }

    return new Response(
      JSON.stringify({ updated, statuses }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("check-arpege-ticket-status error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
