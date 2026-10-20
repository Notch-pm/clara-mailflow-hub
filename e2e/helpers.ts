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
    signataireAlpha: string;
    viseurAlpha: string;
    gestionnaireAlpha: string;
    eluAlpha: string;
    superviseurAlpha: string;
    techAlpha: string;
    adminBeta: string;
    membreBeta: string;
    superadminTest: string;
  };
  signataireAlphaSignatoryId: string;
  alpha: TenantFixture;
  beta: TenantFixture;
}
export interface TenantFixture {
  orgId: string;
  name: string;
  rootSocleOrgId: string;
  subSocleOrgId: string;
  techSocleOrgId: string;
  techCourierId: string;
  fullSocleOrgId: string;
  fullStates: { initial: string; processing: string; processed: string; archived: string };
  fullReplyStates: { draft: string; visa: string; signature: string; send: string; done: string };
  rootDocument: { storageKey: string; fileName: string };
  workflowId: string;
  replyWorkflowId: string;
  couriers: { assigned: string; root: string; unassigned: string };
  states: { initial: string; processing: string; final: string };
  replyStates: { initial: string; signature: string; final: string; visa: string; abandon: string; correction: string };
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

/** Suffixe unique par exécution : les données créées par un test sont toujours identifiables. */
export const RUN_ID = `${Date.now().toString(36)}`;
export function uniq(label: string): string {
  return `[TEST] E2E ${label} ${RUN_ID}`;
}

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

/** Toast sonner contenant `text` (message de succès / d'erreur de l'application). */
export function toastLocator(page: Page, text: string | RegExp) {
  return page.locator("[data-sonner-toast]").filter({ hasText: text }).first();
}

/** Client Supabase authentifié (clé anon + mot de passe de test) : sert à poser un décor AVEC les droits d'un rôle. */
export async function userClient(email: string, password: string) {
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Login ${email}: ${error.message}`);
  return client;
}
