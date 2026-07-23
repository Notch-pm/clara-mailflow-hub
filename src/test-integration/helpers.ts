import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// Helpers de la suite d'intégration RLS : clients Supabase RÉELS, authentifiés
// avec les utilisateurs seedés (bun run seed:test → fixtures.json).

export interface Fixtures {
  seededAt: string;
  supabaseUrl: string;
  password: string;
  users: {
    adminAlpha: string;
    membreAlpha: string;
    consultantAlpha: string;
    superadminTest: string;
    adminBeta: string;
    membreBeta: string;
  };
  alpha: TenantFixture;
  beta: TenantFixture;
}

export interface TenantFixture {
  orgId: string;
  name: string;
  rootSocleOrgId: string;
  subSocleOrgId: string;
  workflowId: string;
  replyWorkflowId: string;
  states: { initial: string; processing: string; final: string };
  replyStates: { initial: string; signature: string; final: string };
  signatoryId: string;
  couriers: { assigned: string; root: string; unassigned: string };
  tagId: string;
  // Fixtures du garde de transitions
  midNoTransitionStateId: string;
  workflowBId: string;
  statesB: { initial: string; mid: string; final: string };
  socleOrgBId: string;
}

function readDotEnv(name: string): string | undefined {
  const p = join(process.cwd(), ".env");
  if (!existsSync(p)) return undefined;
  const m = readFileSync(p, "utf8").match(new RegExp(`^${name}="?([^"\\n]+)"?`, "m"));
  return m?.[1];
}

export const SUPABASE_URL =
  process.env.SUPABASE_URL ?? readDotEnv("VITE_SUPABASE_URL") ?? "";
export const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ?? readDotEnv("VITE_SUPABASE_PUBLISHABLE_KEY") ?? "";
/** Clé service_role (jamais dans .env — fournie inline pour le seed / la CI). */
export const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export function loadFixtures(): Fixtures {
  const p = join(process.cwd(), "src", "test-integration", "fixtures.json");
  if (!existsSync(p)) {
    throw new Error("fixtures.json introuvable — lancez d'abord `bun run seed:test`");
  }
  return JSON.parse(readFileSync(p, "utf8")) as Fixtures;
}

/** Client anonyme (non connecté). */
export function anonClient(): SupabaseClient {
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Client authentifié comme l'utilisateur de test donné. */
export async function clientAs(email: string, password: string): Promise<SupabaseClient> {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Connexion ${email} impossible: ${error.message}`);
  return client;
}

/**
 * Client service_role (bypasse la RLS ET le garde de transitions via le claim
 * JWT `role=service_role`). `null` si la clé n'est pas dans l'environnement.
 */
export function serviceRoleClient(): SupabaseClient | null {
  if (!SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
