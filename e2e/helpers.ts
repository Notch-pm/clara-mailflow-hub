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
  users: { adminAlpha: string; membreAlpha: string; adminBeta: string; membreBeta: string };
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

function readDotEnv(name: string): string {
  const m = readFileSync(join(process.cwd(), ".env"), "utf8").match(
    new RegExp(`^${name}="?([^"\\n]+)"?`, "m"),
  );
  if (!m) throw new Error(`${name} absent de .env`);
  return m[1];
}

const SUPABASE_URL = readDotEnv("VITE_SUPABASE_URL");
const ANON_KEY = readDotEnv("VITE_SUPABASE_PUBLISHABLE_KEY");
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
