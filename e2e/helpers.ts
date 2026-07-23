import type { Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// Helpers E2E : fixtures seedées + connexion programmatique (session injectée
// dans localStorage avant le chargement de l'app — pas de formulaire de login
// à rejouer dans chaque test).

export interface E2eFixtures {
  supabaseUrl: string;
  password: string;
  users: {
    adminAlpha: string;
    membreAlpha: string;
    consultantAlpha: string;
    adminBeta: string;
    membreBeta: string;
  };
  alpha: TenantFixture;
  beta: TenantFixture;
}
interface TenantFixture {
  orgId: string;
  name: string;
  rootSocleOrgId: string;
  subSocleOrgId: string;
  couriers: { assigned: string; root: string; unassigned: string };
  states: { initial: string; processing: string; final: string };
}

export function loadFixtures(): E2eFixtures {
  const p = join(process.cwd(), "src", "test-integration", "fixtures.json");
  if (!existsSync(p)) throw new Error("fixtures.json introuvable — lancez `bun run seed:test`");
  return JSON.parse(readFileSync(p, "utf8")) as E2eFixtures;
}

function readDotEnv(name: string): string | undefined {
  const p = join(process.cwd(), ".env");
  if (!existsSync(p)) return undefined;
  const m = readFileSync(p, "utf8").match(new RegExp(`^${name}="?([^"\\n]+)"?`, "m"));
  return m?.[1];
}

// En CI, il n'y a pas de .env (gitignoré) : URL et clé anon arrivent par
// l'environnement du job (cf. .github/workflows/ci.yml).
const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? readDotEnv("VITE_SUPABASE_URL") ?? "";
const ANON_KEY =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  process.env.SUPABASE_ANON_KEY ??
  readDotEnv("VITE_SUPABASE_PUBLISHABLE_KEY") ??
  "";
if (!SUPABASE_URL || !ANON_KEY) {
  throw new Error("URL/clé anon Supabase introuvables (.env local ou variables d'environnement).");
}
const PROJECT_REF = new URL(SUPABASE_URL).hostname.split(".")[0];

/**
 * Connecte `email` et injecte session + organisation active dans le
 * localStorage de la page (clé `clara_org_id` lue par OrganizationContext).
 */
export async function loginAs(
  page: Page,
  email: string,
  password: string,
  organizationId?: string,
): Promise<void> {
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(`Login E2E ${email}: ${error?.message}`);

  // Organisation active : celle du membership si non fournie
  let orgId = organizationId;
  if (!orgId) {
    const { data: memberships } = await client
      .from("organization_users")
      .select("organization_id")
      .eq("user_id", data.session.user.id)
      .limit(1);
    orgId = (memberships?.[0] as { organization_id: string } | undefined)?.organization_id;
  }

  const storageKey = `sb-${PROJECT_REF}-auth-token`;
  const session = JSON.stringify(data.session);
  await page.addInitScript(
    ([key, value, org]) => {
      window.localStorage.setItem(key, value);
      if (org) window.localStorage.setItem("clara_org_id", org);
    },
    [storageKey, session, orgId ?? ""] as const,
  );
}
