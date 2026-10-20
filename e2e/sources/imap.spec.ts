import { loadFixtures, loginAs, uniq } from "../helpers";
import { test, expect } from "../support/fixtures";
import { adminClient } from "../support/admin";
import { depositMail } from "../support/mailbox";
import { addImapBox, openImapSettings, testAndFetch } from "../pages/imap";

// ═══ Sources par boîte mail : import IMAP vers une organisation, sans organisation
// cible, et boîte de numérisation (scanner). Boîtes Ethereal jetables (voir
// e2e/support/mailbox.ts) : un administrateur les configure par l'écran
// « Emails (IMAP) », le test y dépose un message puis clique « Récupérer ».
// Seuls les messages posés par le test sont relevés (boîtes neuves, uniques).

const fx = loadFixtures();

test.describe.configure({ mode: "serial" });

async function cleanBoxes(label: string) {
  await adminClient().from("imap_settings").delete().eq("organization_id", fx.alpha.orgId).like("label", `${label}%`);
}

test.beforeEach(async ({ page }) => {
  await loginAs(page, fx.users.adminAlpha, fx.password);
});

test("import IMAP vers une organisation : le courrier naît rattaché à cette organisation", async ({ page, needMail }) => {
  const { incoming } = needMail();
  test.setTimeout(240_000);
  const subject = uniq("imap org");
  const label = uniq("boîte org");
  try {
    await depositMail(incoming, { subject, from: "usager.e2e@example.test", text: "Bonjour, ceci est un courriel de test E2E." });
    await openImapSettings(page);
    await addImapBox(page, { label, box: incoming, orgName: "[TEST] Cabinet Alpha" });
    expect(await testAndFetch(page, label)).toBeGreaterThanOrEqual(1);

    // Côté interface : le service courrier le voit dans « Courrier entrant »
    await page.goto("/courrier-entrant");
    await expect(page.getByText(subject).first()).toBeVisible({ timeout: 20_000 });
    // Côté données : canal email, organisation = Cabinet
    const { data } = await adminClient().from("couriers").select("channel, socle_organization_id").eq("organization_id", fx.alpha.orgId).eq("subject", subject).single();
    expect(data).toMatchObject({ channel: "email", socle_organization_id: fx.alpha.subSocleOrgId });
  } finally {
    await cleanBoxes(label);
  }
});

test("import IMAP sans organisation cible : le courrier arrive non assigné (Courrier entrant)", async ({ page, needMail }) => {
  const { incoming } = needMail();
  test.setTimeout(240_000);
  const subject = uniq("imap sans org");
  const label = uniq("boîte sans org");
  try {
    await depositMail(incoming, { subject, from: "usager2.e2e@example.test" });
    await openImapSettings(page);
    await addImapBox(page, { label, box: incoming });
    expect(await testAndFetch(page, label)).toBeGreaterThanOrEqual(1);

    const { data } = await adminClient().from("couriers").select("channel, socle_organization_id").eq("organization_id", fx.alpha.orgId).eq("subject", subject).single();
    expect(data).toMatchObject({ channel: "email", socle_organization_id: null });
    await page.goto("/courrier-entrant");
    await expect(page.getByText(subject).first()).toBeVisible({ timeout: 20_000 });
  } finally {
    await cleanBoxes(label);
  }
});

test("boîte de numérisation : un scan d'un copieur autorisé devient un courrier papier ; un expéditeur inconnu est refusé", async ({ page, needMail }) => {
  const { scanner } = needMail();
  test.setTimeout(300_000);
  const good = uniq("scan autorisé");
  const bad = uniq("scan intrus");
  const label = uniq("boîte scan");
  try {
    await depositMail(scanner, { subject: good, from: "copieur.e2e@example.test", text: "Scan", attachments: [{ filename: "scan.pdf", contentType: "application/pdf", content: (await import("../support/files")).courrierTypePdf("scan") }] });
    await depositMail(scanner, { subject: bad, from: "intrus@example.test", text: "Injection" });
    await openImapSettings(page);
    await addImapBox(page, { label, box: scanner, scanSenders: ["copieur.e2e@example.test"] });
    await testAndFetch(page, label);
    // Le refus reste VISIBLE sur la boîte (jamais une relève « saine » silencieuse)
    await expect(page.getByText(/expéditeur non autorisé — intrus@example\.test/).first()).toBeVisible({ timeout: 15_000 });

    // Un scan prend un objet fixe (« Courrier numérisé — à qualifier ») : on le retrouve par sa boîte.
    const admin = adminClient();
    const { data: box } = await admin.from("imap_settings").select("id").eq("organization_id", fx.alpha.orgId).eq("label", label).single();
    const boxId = (box as { id: string }).id;
    const { data: scans } = await admin.from("couriers").select("id, channel, metadata").eq("organization_id", fx.alpha.orgId).eq("metadata->>imap_settings_id", boxId);
    expect(scans ?? [], "seul le scan du copieur autorisé est importé").toHaveLength(1);
    expect(scans![0]).toMatchObject({ channel: "paper", metadata: { source: "scan", scan_device_email: "copieur.e2e@example.test", needs_qualification: true } });
    // L'intrus n'a rien créé (ni sous son objet, ni sous celui du scan)
    const { data: intrus } = await admin.from("couriers").select("id").eq("organization_id", fx.alpha.orgId).eq("subject", bad);
    expect(intrus ?? []).toHaveLength(0);
    // L'OCR/analyse est enfilée d'office (personne n'est devant l'écran pour cliquer « Analyser »)
    const { data: jobs } = await admin.from("courier_analysis_jobs").select("id, status").eq("courier_id", scans![0].id);
    expect(jobs?.length ?? 0).toBeGreaterThanOrEqual(1);
    // …et le scan attend la qualification dans « Courrier entrant »
    await page.goto("/courrier-entrant");
    await expect(page.getByText("Courrier numérisé — à qualifier").first()).toBeVisible({ timeout: 20_000 });
  } finally {
    await cleanBoxes(label);
  }
});
