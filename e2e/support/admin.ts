import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { TestMailbox } from "./mailbox";

// Client service_role des E2E : préparation et VÉRIFICATION de données
// uniquement ([TEST] — jamais d'écriture hors tenants de test). Absent en
// l'absence de SUPABASE_SERVICE_ROLE_KEY : les specs qui en dépendent se
// sautent avec une raison explicite plutôt que d'échouer.

export const hasServiceRole = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "") !== "";

export function supabaseUrl(): string {
  const fromEnv = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
  if (fromEnv) return fromEnv;
  const p = join(process.cwd(), ".env");
  if (existsSync(p)) {
    const m = readFileSync(p, "utf8").match(/^VITE_SUPABASE_URL="?([^"\n]+)"?/m);
    if (m) return m[1];
  }
  throw new Error("URL Supabase introuvable");
}

let cached: SupabaseClient | null = null;
export function adminClient(): SupabaseClient {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY manquant");
  cached ??= createClient(supabaseUrl(), key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

// ─── Boîtes mail de test ─────────────────────────────────────────────────────
// Créées par globalSetup et transmises aux workers par l'environnement du
// process (jamais écrites sur disque : ce sont des identifiants, même jetables).

export interface MailBoxes {
  /** Relais SMTP de [TEST] Alpha : capte tout ce que Clara envoie. */
  outgoing: TestMailbox;
  /** Boîte relevée par l'import IMAP. */
  incoming: TestMailbox;
  /** Boîte relevée comme « boîte de numérisation ». */
  scanner: TestMailbox;
}
export const MAILBOXES_ENV = "E2E_MAILBOXES";
export function loadMailboxes(): MailBoxes | null {
  const raw = process.env[MAILBOXES_ENV];
  return raw ? (JSON.parse(raw) as MailBoxes) : null;
}

/** Pose un courrier entrant minimal (service_role), avec un expéditeur joignable si demandé. */
export async function insertInboundCourier(args: {
  organizationId: string;
  subject: string;
  socleOrganizationId?: string | null;
  /** Nom de l'organisation gestionnaire : l'écran résout l'organisation par ce nom, il est indispensable. */
  assignedService?: string | null;
  workflowStateId: string;
  senderEmail?: string;
  senderName?: string;
}): Promise<string> {
  const admin = adminClient();
  const { data, error } = await admin
    .from("couriers")
    .insert({
      organization_id: args.organizationId,
      direction: "inbound",
      channel: "paper",
      subject: args.subject,
      received_at: new Date().toISOString(),
      socle_organization_id: args.socleOrganizationId ?? null,
      assigned_service: args.assignedService ?? null,
      workflow_state_id: args.workflowStateId,
    })
    .select("id")
    .single();
  if (error) throw new Error(`insertInboundCourier: ${error.message}`);
  const id = (data as { id: string }).id;
  if (args.senderEmail) {
    const { error: pErr } = await admin.from("courier_participants").insert({
      organization_id: args.organizationId,
      courier_id: id,
      role: "sender",
      name: args.senderName ?? "Usager E2E",
      email: args.senderEmail,
    });
    if (pErr) throw new Error(`participant: ${pErr.message}`);
  }
  return id;
}
