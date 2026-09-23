// Qui lit les demandes Iris, et avec quel périmètre — partagé par
// `iris-contact-requests` (liste d'un usager) et `iris-request-detail` (fil
// d'une demande). Voir docs/iris-integration.md §5 ter.
//
// Tout membre actif du tenant peut lire (consultant compris : rien n'est
// écrit). Le périmètre est appliqué côté serveur : hors administrateur et
// superadmin, seules les organisations Socle de l'appelant (+ les demandes sans
// organisme, cf. `isInScope`).

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-org-id, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export interface IrisReader {
  supabaseAdmin: SupabaseClient;
  /** `null` = tout le tenant ; sinon UUID Socle (minuscules) des organisations de l'appelant. */
  allowedSocleOrgIds: Set<string> | null;
}

/** Authentifie l'appelant sur `organizationId` et calcule son périmètre — ou rend la réponse d'erreur. */
export async function resolveIrisReader(req: Request, organizationId: string): Promise<IrisReader | Response> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return jsonResponse({ error: "Non autorisé" }, 401);

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: userErr } = await callerClient.auth.getUser();
  if (userErr || !user) return jsonResponse({ error: "Non autorisé" }, 401);

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
    if (!membership) return jsonResponse({ error: "Accès refusé" }, 403);
    role = membership.role as string;
  }
  if (isSuperadmin || role === "administrateur" || role === "admin") {
    return { supabaseAdmin, allowedSocleOrgIds: null };
  }

  const { data: members, error } = await supabaseAdmin
    .from("socle_organization_members")
    .select("socle_organization:socle_organizations(socle_id)")
    .eq("user_id", user.id)
    .eq("organization_id", organizationId);
  if (error) throw error;
  const allowedSocleOrgIds = new Set(
    (members ?? [])
      .map((m) => {
        const org = m.socle_organization as { socle_id?: string | null } | Array<{ socle_id?: string | null }> | null;
        return (Array.isArray(org) ? org[0]?.socle_id : org?.socle_id) ?? null;
      })
      .filter((id): id is string => !!id)
      .map((id) => id.toLowerCase()),
  );
  return { supabaseAdmin, allowedSocleOrgIds };
}

/** Libellés de démarches et d'organismes, lus dans les miroirs du tenant. */
export async function loadLabels(
  supabaseAdmin: SupabaseClient,
  organizationId: string,
  procedureIds: string[],
  orgIds: string[],
): Promise<{ procedures: Array<{ key: string | null; value: string | null }>; organizations: Array<{ key: string | null; value: string | null }> }> {
  const [procedures, organizations] = await Promise.all([
    procedureIds.length
      ? supabaseAdmin.from("procedures").select("socle_id, name").eq("organization_id", organizationId).in("socle_id", procedureIds)
      : Promise.resolve({ data: [], error: null }),
    orgIds.length
      ? supabaseAdmin.from("socle_organizations").select("socle_id, name").eq("organization_id", organizationId).in("socle_id", orgIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (procedures.error) throw procedures.error;
  if (organizations.error) throw organizations.error;
  return {
    procedures: (procedures.data ?? []).map((p: { socle_id: string | null; name: string | null }) => ({ key: p.socle_id, value: p.name })),
    organizations: (organizations.data ?? []).map((o: { socle_id: string | null; name: string | null }) => ({ key: o.socle_id, value: o.name })),
  };
}
