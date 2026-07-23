/**
 * Seed de l'environnement de test — tenants `[TEST]` sur le projet Supabase.
 *
 * Usage :
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... bun scripts/seed-test-env.ts [--clean-only]
 *   (clés : `supabase projects api-keys --project-ref <ref>`)
 *
 * Le script est REJOUABLE : il purge d'abord tout ce qui porte le préfixe [TEST]
 * (organisations) / le domaine @test.clara.local (utilisateurs), puis recrée un
 * état déterministe. Il ne touche JAMAIS aux autres tenants.
 *
 * Produit : src/test-integration/fixtures.json (ids + emails — gitignoré),
 * consommé par la suite d'intégration RLS et les E2E Playwright.
 */
import { createClient } from "@supabase/supabase-js";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "https://aullweizxcjbvtdspjli.supabase.co";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_ROLE_KEY) {
  console.error("SUPABASE_SERVICE_ROLE_KEY manquant (supabase projects api-keys --project-ref <ref>)");
  process.exit(1);
}

export const TEST_PASSWORD = process.env.TEST_USER_PASSWORD ?? "ClaraTest!2026";
const TEST_EMAIL_DOMAIN = "test.clara.local";
const TEST_PREFIX = "[TEST]";

/**
 * Racine « [TEST] » du Socle (projet qhrokbkyxgcvkbpmbmna) : le tenant Alpha
 * naît RATTACHÉ au référentiel de test — contacts, doublons et sync manuelle
 * fonctionnent dès le seed. Beta reste non rattaché (cas « organisation hors
 * référentiel »). NB : une sync réelle renomme ensuite le tenant du nom de la
 * racine Socle et remplace les miroirs factices ci-dessous — sans incidence
 * sur les suites, qui reseedent toujours avant de s'exécuter.
 */
const SOCLE_TEST_ROOT_ID =
  process.env.SOCLE_TEST_ORG_ID ?? "b605d41d-3f0b-41d3-bc76-e70237407dcf";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function fail(step: string, error: unknown): never {
  console.error(`✗ ${step}:`, error);
  process.exit(1);
}

async function insertOne<T = Record<string, unknown>>(table: string, row: Record<string, unknown>): Promise<T> {
  const { data, error } = await admin.from(table).insert(row).select("*").single();
  if (error) fail(`insert ${table}`, error.message);
  return data as T;
}

// ─── Purge ciblée [TEST] ──────────────────────────────────────────────────────

async function cleanup() {
  console.log("— Purge des données [TEST] existantes…");

  const { data: orgs } = await admin
    .from("organizations")
    .select("id, name")
    .like("name", `${TEST_PREFIX}%`);
  const orgIds = (orgs ?? []).map((o) => o.id);

  if (orgIds.length > 0) {
    // Ordre de dépendances (pas de cascade garanti partout)
    const tablesByOrg = [
      "courier_events", "courier_notes", "courier_participants", "courier_documents",
      "action_tickets", "couriers", "courier_sequences",
      "socle_organization_members", "socle_organization_signatories",
      "imap_settings", "smtp_settings", "portal_forms",
      "socle_organizations", "socle_categories", "socle_document_types", "socle_sync_runs",
      "workflow_transitions", "workflow_states", "workflows",
      "courier_tags", "signatories", "service_members", "service_signatories",
      "services", "notifications", "procedures", "organization_users",
    ];
    for (const table of tablesByOrg) {
      const { error } = await admin.from(table).delete().in("organization_id", orgIds);
      // certaines tables n'ont pas organization_id ou sont vides : on ignore les erreurs de colonne
      if (error && !/column .* does not exist/.test(error.message)) {
        console.warn(`  purge ${table}: ${error.message}`);
      }
    }
    const { error: orgErr } = await admin.from("organizations").delete().in("id", orgIds);
    if (orgErr) fail("purge organizations", orgErr.message);
    console.log(`  ${orgIds.length} organisation(s) [TEST] supprimée(s)`);
  }

  // Utilisateurs de test (auth + miroir public.users)
  let page = 1;
  let deleted = 0;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) fail("listUsers", error.message);
    const testUsers = data.users.filter((u) => u.email?.endsWith(`@${TEST_EMAIL_DOMAIN}`));
    for (const u of testUsers) {
      await admin.from("users").delete().eq("id", u.id);
      const { error: delErr } = await admin.auth.admin.deleteUser(u.id);
      if (delErr) console.warn(`  deleteUser ${u.email}: ${delErr.message}`);
      else deleted++;
    }
    if (data.users.length < 200) break;
    page++;
  }
  console.log(`  ${deleted} utilisateur(s) de test supprimé(s)`);
}

// ─── Création ─────────────────────────────────────────────────────────────────

interface SeededUser { id: string; email: string }

async function createUser(
  local: string,
  firstName: string,
  lastName: string,
  isSuperadmin = false,
): Promise<SeededUser> {
  const email = `${local}@${TEST_EMAIL_DOMAIN}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
    user_metadata: { first_name: firstName, last_name: lastName },
  });
  if (error || !data.user) fail(`createUser ${email}`, error?.message);
  // NB : le trigger users_prevent_superadmin_escalation ne vise que l'UPDATE —
  // l'INSERT service_role d'un superadmin de test est permis.
  await insertOne("users", {
    id: data.user.id,
    email,
    first_name: firstName,
    last_name: lastName,
    is_active: true,
    is_superadmin: isSuperadmin,
  });
  return { id: data.user.id, email };
}

interface TenantFixture {
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

async function seedTenant(letter: "Alpha" | "Beta"): Promise<TenantFixture> {
  const name = `${TEST_PREFIX} ${letter}`;
  const slug = `test-${letter.toLowerCase()}`;
  console.log(`— Création du tenant ${name}…`);

  const org = await insertOne<{ id: string }>("organizations", {
    name, slug, status: "active",
    ...(letter === "Alpha" ? { socle_org_id: SOCLE_TEST_ROOT_ID } : {}),
  });

  // Workflows (principal + réponse) avec états et transitions
  const wf = await insertOne<{ id: string }>("workflows", {
    organization_id: org.id, name: `WF ${TEST_PREFIX} Principal ${letter}`, type: "inbound", is_default: true,
  });
  const stInitial = await insertOne<{ id: string }>("workflow_states", {
    organization_id: org.id, workflow_id: wf.id, name: "Reçu", category: "pending", is_initial: true,
  });
  const stProcessing = await insertOne<{ id: string }>("workflow_states", {
    organization_id: org.id, workflow_id: wf.id, name: "En instruction", category: "processing",
  });
  const stFinal = await insertOne<{ id: string }>("workflow_states", {
    organization_id: org.id, workflow_id: wf.id, name: "Traité", category: "processed", is_final: true,
  });
  await insertOne("workflow_transitions", {
    organization_id: org.id, workflow_id: wf.id, name: "Instruire", kind: "next",
    from_state_id: stInitial.id, to_state_id: stProcessing.id,
  });
  await insertOne("workflow_transitions", {
    organization_id: org.id, workflow_id: wf.id, name: "Clôturer", kind: "next",
    from_state_id: stProcessing.id, to_state_id: stFinal.id,
  });

  const replyWf = await insertOne<{ id: string }>("workflows", {
    organization_id: org.id, name: `WF ${TEST_PREFIX} Réponse ${letter}`, type: "reply",
  });
  const rInitial = await insertOne<{ id: string }>("workflow_states", {
    organization_id: org.id, workflow_id: replyWf.id, name: "En rédaction", category: "processing", is_initial: true,
  });
  const rSignature = await insertOne<{ id: string }>("workflow_states", {
    organization_id: org.id, workflow_id: replyWf.id, name: "À signer", category: "processing", requires_signature: true,
  });
  const rFinal = await insertOne<{ id: string }>("workflow_states", {
    organization_id: org.id, workflow_id: replyWf.id, name: "Terminée", category: "processed", is_final: true,
  });
  await insertOne("workflow_transitions", {
    organization_id: org.id, workflow_id: replyWf.id, name: "Envoyer en signature", kind: "next",
    from_state_id: rInitial.id, to_state_id: rSignature.id,
  });
  await insertOne("workflow_transitions", {
    organization_id: org.id, workflow_id: replyWf.id, name: "Terminer", kind: "next",
    from_state_id: rSignature.id, to_state_id: rFinal.id,
  });

  // Miroir socle : racine + sous-organisation (insert direct service_role,
  // le Socle réel n'est pas impliqué dans les tests)
  const rootSocle = await insertOne<{ id: string }>("socle_organizations", {
    organization_id: org.id,
    socle_id: crypto.randomUUID(),
    name, status: "active",
    workflow_id: wf.id, reply_workflow_id: replyWf.id,
  });
  const subSocle = await insertOne<{ id: string }>("socle_organizations", {
    organization_id: org.id,
    socle_id: crypto.randomUUID(),
    socle_parent_id: null, // renseigné après (référence socle_id de la racine)
    name: `${TEST_PREFIX} Cabinet ${letter}`, status: "active",
    workflow_id: wf.id, reply_workflow_id: replyWf.id,
  });
  // Rattache la sous-org à la racine via socle_id
  const { data: rootRow } = await admin.from("socle_organizations").select("socle_id").eq("id", rootSocle.id).single();
  await admin.from("socle_organizations").update({ socle_parent_id: (rootRow as { socle_id: string }).socle_id }).eq("id", subSocle.id);

  // ─── Fixtures du garde de transitions ───────────────────────────────────────
  // Un état intermédiaire du workflow principal SANS transition entrante (AC-S3 :
  // un saut initial → cet état doit être refusé).
  const stMidNoTransition = await insertOne<{ id: string }>("workflow_states", {
    organization_id: org.id, workflow_id: wf.id,
    name: `${TEST_PREFIX} Intermédiaire sans transition ${letter}`, category: "processing",
  });
  // Un SECOND workflow (WF_B) doté de sa propre organisation Socle (AC-S4 : une
  // réassignation vers cette org avec un état intermédiaire de WF_B doit être refusée).
  const wfB = await insertOne<{ id: string }>("workflows", {
    organization_id: org.id, name: `WF ${TEST_PREFIX} B ${letter}`, type: "inbound",
  });
  const sbInitial = await insertOne<{ id: string }>("workflow_states", {
    organization_id: org.id, workflow_id: wfB.id, name: "Reçu B", category: "pending", is_initial: true,
  });
  const sbMid = await insertOne<{ id: string }>("workflow_states", {
    organization_id: org.id, workflow_id: wfB.id, name: "En cours B", category: "processing",
  });
  const sbFinal = await insertOne<{ id: string }>("workflow_states", {
    organization_id: org.id, workflow_id: wfB.id, name: "Traité B", category: "processed", is_final: true,
  });
  await insertOne("workflow_transitions", {
    organization_id: org.id, workflow_id: wfB.id, name: "Instruire B", kind: "next",
    from_state_id: sbInitial.id, to_state_id: sbMid.id,
  });
  const socleOrgB = await insertOne<{ id: string }>("socle_organizations", {
    organization_id: org.id, socle_id: crypto.randomUUID(),
    name: `${TEST_PREFIX} Org B ${letter}`, status: "active",
    workflow_id: wfB.id, reply_workflow_id: replyWf.id,
  });

  // Signataire
  const signatory = await insertOne<{ id: string }>("signatories", {
    organization_id: org.id, first_name: "Signe", last_name: `${letter} Test`, title: "Maire de test",
  });
  await insertOne("socle_organization_signatories", {
    organization_id: org.id, socle_organization_id: rootSocle.id, signatory_id: signatory.id,
  });

  // Courriers de fixture
  const courierAssigned = await insertOne<{ id: string }>("couriers", {
    organization_id: org.id, direction: "inbound", channel: "paper",
    subject: `${TEST_PREFIX} Courrier ${letter} assigné cabinet`,
    received_at: new Date().toISOString(),
    assigned_service: `${TEST_PREFIX} Cabinet ${letter}`,
    socle_organization_id: subSocle.id,
    workflow_state_id: stInitial.id,
  });
  const courierRoot = await insertOne<{ id: string }>("couriers", {
    organization_id: org.id, direction: "inbound", channel: "paper",
    subject: `${TEST_PREFIX} Courrier ${letter} racine`,
    received_at: new Date().toISOString(),
    assigned_service: name,
    socle_organization_id: rootSocle.id,
    workflow_state_id: stInitial.id,
  });
  const courierUnassigned = await insertOne<{ id: string }>("couriers", {
    organization_id: org.id, direction: "inbound", channel: "paper",
    subject: `${TEST_PREFIX} Courrier ${letter} non assigné`,
    received_at: new Date().toISOString(),
    workflow_state_id: stInitial.id,
  });

  const tag = await insertOne<{ id: string }>("courier_tags", {
    organization_id: org.id, name: `${TEST_PREFIX} Tag ${letter}`, color: "#0acf83",
  });

  return {
    orgId: org.id, name,
    rootSocleOrgId: rootSocle.id, subSocleOrgId: subSocle.id,
    workflowId: wf.id, replyWorkflowId: replyWf.id,
    states: { initial: stInitial.id, processing: stProcessing.id, final: stFinal.id },
    replyStates: { initial: rInitial.id, signature: rSignature.id, final: rFinal.id },
    signatoryId: signatory.id,
    couriers: { assigned: courierAssigned.id, root: courierRoot.id, unassigned: courierUnassigned.id },
    tagId: tag.id,
    midNoTransitionStateId: stMidNoTransition.id,
    workflowBId: wfB.id,
    statesB: { initial: sbInitial.id, mid: sbMid.id, final: sbFinal.id },
    socleOrgBId: socleOrgB.id,
  };
}

async function main() {
  const cleanOnly = process.argv.includes("--clean-only");
  await cleanup();
  if (cleanOnly) {
    console.log("✓ Purge terminée (--clean-only)");
    return;
  }

  const alpha = await seedTenant("Alpha");
  const beta = await seedTenant("Beta");

  console.log("— Création des utilisateurs de test…");
  const adminAlpha = await createUser("admin.alpha", "Admin", "Alpha");
  const membreAlpha = await createUser("membre.alpha", "Membre", "Alpha");
  const consultantAlpha = await createUser("consultant.alpha", "Consultant", "Alpha");
  const adminBeta = await createUser("admin.beta", "Admin", "Beta");
  // Superadmin global (aucun membership d'org — is_member_of/is_admin_of l'incluent)
  const superadminTest = await createUser("superadmin.test", "Super", "Admin", true);
  const membreBeta = await createUser("membre.beta", "Membre", "Beta");

  const memberships = [
    { organization_id: alpha.orgId, user_id: adminAlpha.id, role: "administrateur", is_active: true },
    { organization_id: alpha.orgId, user_id: membreAlpha.id, role: "member", is_active: true },
    // Consultant ACTIF d'Alpha : lit tout (is_member_of) mais n'écrit rien (is_editor_of).
    { organization_id: alpha.orgId, user_id: consultantAlpha.id, role: "consultant", is_active: true },
    { organization_id: beta.orgId, user_id: adminBeta.id, role: "administrateur", is_active: true },
    { organization_id: beta.orgId, user_id: membreBeta.id, role: "member", is_active: true },
  ];
  for (const m of memberships) await insertOne("organization_users", m);

  // membre.alpha + consultant.alpha appartiennent à la sous-org « Cabinet Alpha »
  // (filtrage des courriers par organisation Socle)
  await insertOne("socle_organization_members", {
    organization_id: alpha.orgId, socle_organization_id: alpha.subSocleOrgId, user_id: membreAlpha.id,
  });
  await insertOne("socle_organization_members", {
    organization_id: alpha.orgId, socle_organization_id: alpha.subSocleOrgId, user_id: consultantAlpha.id,
  });

  const fixtures = {
    seededAt: new Date().toISOString(),
    supabaseUrl: SUPABASE_URL,
    password: TEST_PASSWORD,
    users: {
      adminAlpha: adminAlpha.email,
      membreAlpha: membreAlpha.email,
      consultantAlpha: consultantAlpha.email,
      superadminTest: superadminTest.email,
      adminBeta: adminBeta.email,
      membreBeta: membreBeta.email,
    },
    alpha, beta,
  };
  const out = join(process.cwd(), "src", "test-integration", "fixtures.json");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(fixtures, null, 2), "utf8");
  console.log(`✓ Seed terminé — fixtures écrites dans ${out}`);
}

main();
