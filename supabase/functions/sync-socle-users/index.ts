// Agents gérés par le Socle — synchronisation Socle → Clara.
//
// Le Socle décide qui accède à Clara (`GET /v1/users`, public-api 1.43.0,
// scope `users` sur la clé SOCLE_API_KEY). Pour chaque tenant rattaché au
// Socle (`organizations.socle_org_id`), cette fonction applique :
//   - le compte (créé à la première ouverture, invitation par le relais du
//     tenant ; banni quand plus rien n'est actif — jamais supprimé) ;
//   - l'appartenance `organization_users` (rôle de base, actif ou non) ;
//   - les affectations `socle_organization_members`.
// Les droits fins (signataire, viseur…) ne sont jamais touchés. Logique pure :
// logic.ts.
//
// Deux modes (corps JSON) :
//   - `incremental` (défaut, cron chaque minute) : depuis le curseur du tenant
//     (`socle_user_sync_state.cursor` = `as_of` du dernier appel réussi) ;
//   - `full` (cron nocturne) : liste complète, et les agents rattachés absents
//     de la liste perdent leurs accès (cascades côté Socle).
// `organization_id` borne à un tenant ; `dry_run: true` n'écrit rien et rend le
// plan.
//
// Auth : x-cron-secret (pg_cron), Bearer SERVICE_ROLE_KEY, ou JWT superadmin.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6";
import { hexOr, renderBrandedEmail } from "../_shared/emailLayout.ts";
import { loadSmtpSettings } from "../_shared/mailCredentials.ts";
import {
  missingFromFullList,
  planAgent,
  readSocleAgents,
  shouldBan,
  type CurrentMembership,
  type SocleAgent,
} from "./logic.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** Bannissement « définitif » (≈ 100 ans) : le compte reste, la connexion est refusée. */
const BAN_DURATION = "876000h";
const SOCLE_TIMEOUT_MS = 20_000;

type Admin = SupabaseClient;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function socleBaseUrl(): string {
  return (
    Deno.env.get("SOCLE_API_URL") ?? "https://qhrokbkyxgcvkbpmbmna.supabase.co/functions/v1/public-api"
  ).replace(/\/+$/, "");
}

async function fetchAgents(socleOrgId: string, since: string | null): Promise<Response> {
  const apiKey = Deno.env.get("SOCLE_API_KEY")?.trim();
  if (!apiKey) throw new Error("Secret SOCLE_API_KEY manquant.");
  const params = new URLSearchParams({ tenant_id: socleOrgId });
  if (since) params.set("updated_since", since);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SOCLE_TIMEOUT_MS);
  try {
    return await fetch(`${socleBaseUrl()}/v1/users?${params}`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function isAuthorized(req: Request, admin: Admin): Promise<boolean> {
  const cronSecret = req.headers.get("x-cron-secret");
  if (cronSecret) {
    const { data } = await admin.rpc("get_cron_secret");
    if (typeof data === "string" && data !== "" && data === cronSecret) return true;
  }
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return false;
  const token = authHeader.replace("Bearer ", "").trim();
  if (token === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) return true;
  const { data: { user } } = await admin.auth.getUser(token);
  if (!user) return false;
  const { data: profile } = await admin.from("users").select("is_superadmin").eq("id", user.id).maybeSingle();
  return profile?.is_superadmin === true;
}

/** Invitation au premier accès : même courriel que `invite-user`, relais du tenant. */
async function sendInvitation(admin: Admin, organizationId: string, email: string): Promise<string | null> {
  try {
    const origin = (Deno.env.get("APP_ORIGIN") || "https://clara.edilumen.fr").replace(/\/+$/, "");
    const { data: link, error: linkError } = await admin.auth.admin.generateLink({
      type: "invite",
      email,
      options: { redirectTo: `${origin}/activer-compte` },
    });
    if (linkError || !link?.properties?.action_link) throw new Error(linkError?.message ?? "lien d'invitation");

    const { data: org } = await admin
      .from("organizations")
      .select("name, primary_color, logo_url")
      .eq("id", organizationId)
      .single();
    const { data: smtp } = await loadSmtpSettings(admin, organizationId);
    if (!smtp) throw new Error("aucun serveur d'envoi pour ce tenant");

    const siteName = org?.name || "Clara";
    const bodyText = `Vous avez été invité(e) à rejoindre <strong>${siteName}</strong>. Cliquez sur le bouton ci-dessous pour définir votre mot de passe et activer votre compte.`;
    const html = renderBrandedEmail({
      primary: hexOr(org?.primary_color ?? null, "#18181b"),
      siteName,
      logoUrl: org?.logo_url ?? null,
      heading: "Bienvenue !",
      bodyHtml: `<p style="margin:0 0 28px;font-size:14px;line-height:1.6;color:#52525b;">${bodyText}</p>`,
      action: { label: "Activer mon compte", url: link.properties.action_link },
    });
    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port || 587,
      secure: smtp.use_tls && smtp.port === 465,
      auth: { user: smtp.username, pass: smtp.password },
      tls: smtp.use_tls ? { rejectUnauthorized: false } : undefined,
    });
    await transporter.sendMail({
      from: smtp.from_name ? `${smtp.from_name} <${smtp.from_email}>` : smtp.from_email,
      to: email,
      subject: `Activez votre compte — ${siteName}`,
      html,
      text: `Bienvenue !\n\n${bodyText.replace(/<[^>]+>/g, "")}\n\nActiver mon compte : ${link.properties.action_link}`,
    });
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

interface Counters {
  agents: number;
  created: number;
  memberships: number;
  affectations_added: number;
  affectations_removed: number;
  banned: number;
  unbanned: number;
  skipped: string[];
  invitation_errors: string[];
}

interface UserRow {
  id: string;
  email: string;
  is_active: boolean | null;
  is_superadmin: boolean;
  socle_user_id: string | null;
  first_name: string | null;
  last_name: string | null;
}

const USER_COLUMNS = "id, email, is_active, is_superadmin, socle_user_id, first_name, last_name";

/** Compte Clara de l'agent : par `socle_user_id`, sinon par e-mail (premier rapprochement). */
async function findUser(admin: Admin, agent: SocleAgent): Promise<UserRow | null> {
  const { data: bySocle } = await admin.from("users").select(USER_COLUMNS).eq("socle_user_id", agent.socle_user_id).maybeSingle();
  if (bySocle) return bySocle as UserRow;
  // `eq` et non `ilike` (« _ » y serait un joker) : Clara enregistre les e-mails en minuscules.
  const { data: byEmail } = await admin.from("users").select(USER_COLUMNS).eq("email", agent.email).maybeSingle();
  const row = byEmail as UserRow | null;
  // Déjà rattaché à un AUTRE agent du Socle : on ne le reprend pas.
  if (row && row.socle_user_id && row.socle_user_id !== agent.socle_user_id) return null;
  return row;
}

async function syncAgent(
  admin: Admin,
  tenantId: string,
  agent: SocleAgent,
  mirror: Map<string, string>,
  dryRun: boolean,
  counters: Counters,
  plans: unknown[],
): Promise<void> {
  counters.agents++;
  let user = await findUser(admin, agent);

  let membership: CurrentMembership | null = null;
  let affectations: string[] = [];
  if (user) {
    const { data: m } = await admin
      .from("organization_users")
      .select("id, role, is_active")
      .eq("organization_id", tenantId)
      .eq("user_id", user.id)
      .maybeSingle();
    membership = (m as CurrentMembership | null) ?? null;
    const { data: a } = await admin
      .from("socle_organization_members")
      .select("socle_organization_id")
      .eq("organization_id", tenantId)
      .eq("user_id", user.id);
    affectations = ((a ?? []) as Array<{ socle_organization_id: string }>).map((r) => r.socle_organization_id);
  }

  const plan = planAgent(agent, membership, affectations, mirror);
  if (dryRun) {
    plans.push({ email: agent.email, socle_user_id: agent.socle_user_id, clara_user_id: user?.id ?? null, ...plan });
    return;
  }
  if (!user && !plan.active) return; // jamais créé pour un agent sans accès

  // 1. Le compte.
  let isNew = false;
  if (!user) {
    const { data: created, error } = await admin.auth.admin.createUser({
      email: agent.email,
      email_confirm: false,
      user_metadata: { first_name: agent.first_name, last_name: agent.last_name },
    });
    if (error || !created?.user) {
      counters.skipped.push(`${agent.email} : ${error?.message ?? "création refusée"}`);
      return;
    }
    const { error: upsertError } = await admin.from("users").upsert(
      {
        id: created.user.id,
        email: agent.email,
        first_name: agent.first_name,
        last_name: agent.last_name,
        is_active: true,
        socle_user_id: agent.socle_user_id,
      },
      { onConflict: "id" },
    );
    if (upsertError) throw upsertError;
    user = { id: created.user.id, email: agent.email, is_active: true, is_superadmin: false, socle_user_id: agent.socle_user_id, first_name: agent.first_name, last_name: agent.last_name };
    isNew = true;
    counters.created++;
  } else {
    const patch: Record<string, unknown> = {};
    if (user.socle_user_id !== agent.socle_user_id) patch.socle_user_id = agent.socle_user_id;
    if (agent.first_name && agent.first_name !== user.first_name) patch.first_name = agent.first_name;
    if (agent.last_name && agent.last_name !== user.last_name) patch.last_name = agent.last_name;
    if (Object.keys(patch).length > 0) {
      const { error } = await admin.from("users").update(patch).eq("id", user.id);
      if (error) throw error;
    }
  }

  // 2. L'appartenance (droits fins préservés : seuls role et is_active bougent).
  if (plan.membership) {
    if (membership) {
      const { error } = await admin.from("organization_users").update(plan.membership).eq("id", membership.id);
      if (error) throw error;
    } else {
      const { error } = await admin
        .from("organization_users")
        .insert({ organization_id: tenantId, user_id: user.id, ...plan.membership });
      if (error) throw error;
    }
    counters.memberships++;
  }

  // 3. Les affectations.
  if (plan.addAffectations.length > 0) {
    const { error } = await admin.from("socle_organization_members").insert(
      plan.addAffectations.map((id) => ({ organization_id: tenantId, socle_organization_id: id, user_id: user!.id })),
    );
    if (error) throw error;
    counters.affectations_added += plan.addAffectations.length;
  }
  if (plan.removeAffectations.length > 0) {
    const { error } = await admin
      .from("socle_organization_members")
      .delete()
      .eq("organization_id", tenantId)
      .eq("user_id", user.id)
      .in("socle_organization_id", plan.removeAffectations);
    if (error) throw error;
    counters.affectations_removed += plan.removeAffectations.length;
  }

  // 4. Bannir ou rétablir le compte, d'après TOUTES ses appartenances.
  const { count } = await admin
    .from("organization_users")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("is_active", true);
  const ban = shouldBan(count ?? 0, user.is_superadmin);
  if (ban && user.is_active !== false) {
    await admin.auth.admin.updateUserById(user.id, { ban_duration: BAN_DURATION });
    await admin.from("users").update({ is_active: false }).eq("id", user.id);
    counters.banned++;
  } else if (!ban && user.is_active === false) {
    await admin.auth.admin.updateUserById(user.id, { ban_duration: "none" });
    await admin.from("users").update({ is_active: true }).eq("id", user.id);
    counters.unbanned++;
  }

  // 5. Invitation au premier accès (Clara invite tant que la connexion unique
  //    n'est pas en place).
  if (isNew) {
    const failure = await sendInvitation(admin, tenantId, agent.email);
    if (failure) counters.invitation_errors.push(`${agent.email} : ${failure}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Méthode non autorisée" });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  if (!(await isAuthorized(req, admin))) return json(401, { error: "Non autorisé" });

  const body = await req.json().catch(() => ({}));
  const mode: "incremental" | "full" = body?.mode === "full" ? "full" : "incremental";
  const dryRun = body?.dry_run === true;
  const onlyTenant: string | null = typeof body?.organization_id === "string" ? body.organization_id : null;

  let query = admin.from("organizations").select("id, name, socle_org_id").not("socle_org_id", "is", null);
  if (onlyTenant) query = query.eq("id", onlyTenant);
  const { data: tenants, error: tenantsError } = await query;
  if (tenantsError) return json(500, { error: tenantsError.message });

  const report: Record<string, unknown>[] = [];
  for (const tenant of (tenants ?? []) as Array<{ id: string; name: string; socle_org_id: string }>) {
    const counters: Counters = {
      agents: 0, created: 0, memberships: 0, affectations_added: 0, affectations_removed: 0,
      banned: 0, unbanned: 0, skipped: [], invitation_errors: [],
    };
    const plans: unknown[] = [];
    const now = new Date().toISOString();
    try {
      const { data: state } = await admin
        .from("socle_user_sync_state")
        .select("cursor")
        .eq("organization_id", tenant.id)
        .maybeSingle();
      // Sans curseur, la première lecture est complète.
      const full = mode === "full" || !state?.cursor;
      const response = await fetchAgents(tenant.socle_org_id, full ? null : state!.cursor);
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Socle ${response.status} : ${text.slice(0, 200)}`);
      }
      const { agents, asOf } = readSocleAgents(await response.json());

      const { data: mirrorRows } = await admin
        .from("socle_organizations")
        .select("id, socle_id")
        .eq("organization_id", tenant.id);
      const mirror = new Map(((mirrorRows ?? []) as Array<{ id: string; socle_id: string }>).map((r) => [r.socle_id, r.id]));

      for (const agent of agents) {
        await syncAgent(admin, tenant.id, agent, mirror, dryRun, counters, plans);
      }

      // Réconciliation : les agents rattachés absents de la liste complète.
      if (full) {
        const { data: managed } = await admin
          .from("organization_users")
          .select("users!inner(socle_user_id, email, first_name, last_name)")
          .eq("organization_id", tenant.id)
          .not("users.socle_user_id", "is", null);
        const rows = ((managed ?? []) as unknown as Array<{ users: { socle_user_id: string; email: string; first_name: string | null; last_name: string | null } }>);
        const missing = new Set(missingFromFullList(rows.map((r) => r.users.socle_user_id), agents));
        for (const r of rows.filter((row) => missing.has(row.users.socle_user_id))) {
          await syncAgent(admin, tenant.id, {
            socle_user_id: r.users.socle_user_id,
            email: r.users.email.toLowerCase(),
            first_name: null,
            last_name: null,
            status: "active",
            is_active: false,
            accesses: [],
          }, mirror, dryRun, counters, plans);
        }
      }

      if (!dryRun) {
        await admin.from("socle_user_sync_state").upsert({
          organization_id: tenant.id,
          cursor: asOf,
          last_run_at: now,
          ...(full ? { last_full_sync_at: now } : {}),
          last_error: null,
          updated_at: now,
        });
      }
      report.push({ tenant: tenant.name, mode: full ? "full" : "incremental", ...counters, ...(dryRun ? { plans } : {}) });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(`[sync-socle-users] ${tenant.name} :`, message);
      if (!dryRun) {
        await admin.from("socle_user_sync_state").upsert({
          organization_id: tenant.id,
          last_run_at: now,
          last_error: message.slice(0, 500),
          updated_at: now,
        });
      }
      report.push({ tenant: tenant.name, error: message, ...counters });
    }
  }

  return json(200, { mode, dry_run: dryRun, tenants: report });
});
