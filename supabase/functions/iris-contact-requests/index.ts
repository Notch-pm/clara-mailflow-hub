// Demandes Iris d'UN usager — lecture seule, pour la fiche contact et l'espace
// élu (docs/iris-integration.md §7).
//
// Body : { organization_id, socle_contact_id }. L'appelant doit être membre
// actif du tenant (ou superadmin). Tout rôle peut lire, consultant compris :
// rien n'est écrit, ni chez Iris ni ici.
//
// Le PÉRIMÈTRE est appliqué ici, côté serveur : ces données appartiennent à un
// autre produit, on ne reproduit pas le filtre « UI seulement » des courriers.
// Hors administrateur et superadmin, seules les demandes des organisations
// Socle de l'appelant (et celles sans organisme) sortent.
//
// Iris répond selon la clé : avec `requests:read_tenant`, toutes les sources ;
// sans, seulement les demandes déposées par Clara. Dans les deux cas c'est une
// réponse valide — la vue est partielle, pas en panne.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { irisErrorMessage } from "../_shared/iris-envelope.ts";
import { listIrisRequestsByContact, resolveIrisIntegration } from "../_shared/iris.ts";
import { buildContactDemandes, lookupMap } from "../_shared/iris-contact-requests.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-org-id, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const json = (payload: unknown, status = 200) =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Non autorisé" }, 401);

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !user) return json({ error: "Non autorisé" }, 401);

    const { organization_id: organizationId, socle_contact_id: contactId } =
      (await req.json().catch(() => ({}))) as { organization_id?: string; socle_contact_id?: string };
    if (!organizationId || !UUID_RE.test(organizationId)) {
      return json({ error: "organization_id invalide (uuid attendu)" }, 400);
    }
    if (!contactId || !UUID_RE.test(contactId)) {
      return json({ error: "socle_contact_id invalide (uuid attendu)" }, 400);
    }

    // Qui lit, et avec quel périmètre.
    const { data: userRow } = await supabaseAdmin
      .from("users")
      .select("is_superadmin")
      .eq("id", user.id)
      .maybeSingle();
    const isSuperadmin = userRow?.is_superadmin === true;
    let role: string | null = null;
    if (!isSuperadmin) {
      const { data: membership } = await supabaseAdmin
        .from("organization_users")
        .select("role")
        .eq("user_id", user.id)
        .eq("organization_id", organizationId)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();
      if (!membership) return json({ error: "Accès refusé" }, 403);
      role = membership.role as string;
    }
    const seesWholeTenant = isSuperadmin || role === "administrateur" || role === "admin";

    let allowedSocleOrgIds: Set<string> | null = null;
    if (!seesWholeTenant) {
      const { data: members, error } = await supabaseAdmin
        .from("socle_organization_members")
        .select("socle_organization:socle_organizations(socle_id)")
        .eq("user_id", user.id)
        .eq("organization_id", organizationId);
      if (error) throw error;
      allowedSocleOrgIds = new Set(
        (members ?? [])
          .map((m) => {
            const org = m.socle_organization as { socle_id?: string | null } | Array<{ socle_id?: string | null }> | null;
            return (Array.isArray(org) ? org[0]?.socle_id : org?.socle_id) ?? null;
          })
          .filter((id): id is string => !!id)
          .map((id) => id.toLowerCase()),
      );
    }

    // Suspendue comprise : la suspension coupe le dépôt, pas la lecture.
    const { integration, reason } = await resolveIrisIntegration(supabaseAdmin, organizationId);
    if (!integration) return json({ skipped: true, reason });

    const { status, body } = await listIrisRequestsByContact(integration, contactId);
    if (status !== 200) {
      console.warn(`[iris] demandes de l'usager : HTTP ${status}`);
      return json({ error: irisErrorMessage(status, body) }, 502);
    }
    const requests = Array.isArray(body?.requests) ? body.requests : [];
    if (requests.length === 0) return json({ demandes: [] });

    // Libellés et lien vers le courrier d'origine, lus dans les miroirs.
    const procedureIds = [...new Set(requests.map((r) => r.socle_procedure_id).filter((v): v is string => !!v))];
    const orgIds = [...new Set(requests.map((r) => r.socle_organization_id).filter((v): v is string => !!v))];
    const requestIds = requests.map((r) => r.id).filter((v): v is string => !!v);

    const [procedures, organizations, tickets] = await Promise.all([
      procedureIds.length
        ? supabaseAdmin.from("procedures").select("socle_id, name").eq("organization_id", organizationId).in("socle_id", procedureIds)
        : Promise.resolve({ data: [], error: null }),
      orgIds.length
        ? supabaseAdmin.from("socle_organizations").select("socle_id, name").eq("organization_id", organizationId).in("socle_id", orgIds)
        : Promise.resolve({ data: [], error: null }),
      supabaseAdmin
        .from("action_tickets")
        .select("iris_request_id, courier_id")
        .eq("organization_id", organizationId)
        .in("iris_request_id", requestIds),
    ]);
    for (const r of [procedures, organizations, tickets]) if (r.error) throw r.error;

    const demandes = buildContactDemandes(
      requests,
      {
        procedures: lookupMap((procedures.data ?? []).map((p) => ({ key: p.socle_id, value: p.name }))),
        organizations: lookupMap((organizations.data ?? []).map((o) => ({ key: o.socle_id, value: o.name }))),
        couriersByIrisRequest: new Map(
          (tickets.data ?? [])
            .filter((t) => t.iris_request_id && t.courier_id)
            .map((t) => [t.iris_request_id as string, t.courier_id as string]),
        ),
      },
      allowedSocleOrgIds,
    );

    return json({ demandes });
  } catch (error) {
    console.error("[iris] iris-contact-requests:", error);
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
