import { loadFixtures, loginAs, uniq, toastLocator } from "../helpers";
import { test, expect } from "../support/fixtures";
import { adminClient, insertInboundCourier } from "../support/admin";
import { assertTestRecipient, testRecipient, waitForMail } from "../support/mailbox";

// ═══ Action liée « tâche interne » : création par un agent, mail au destinataire
// (relais SMTP de test), puis le destinataire — sans compte — la clôt par son
// lien /tache/:token. Le mail est LU pour de vrai (IMAP) : objet, destinataire, lien.

const fx = loadFixtures();

test("tâche : création, mail réel, clôture par le lien du destinataire", async ({ page, browser, needMail }) => {
  const { outgoing } = needMail();
  test.setTimeout(240_000);
  const title = uniq("tâche");
  const to = testRecipient("tache");
  const courierId = await insertInboundCourier({
    organizationId: fx.alpha.orgId,
    subject: uniq("courrier pour tâche"),
    socleOrganizationId: fx.alpha.rootSocleOrgId,
    assignedService: fx.alpha.name,
    workflowStateId: fx.alpha.states.processing, // seule une instruction en cours accepte une action
  });

  await loginAs(page, fx.users.adminAlpha, fx.password);
  await page.goto(`/courrier/${courierId}`);
  await page.getByRole("tab", { name: /Actions liées/ }).click();
  await page.getByRole("button", { name: /^Créer/ }).click();
  await page.getByRole("menuitem", { name: /Tâche/ }).click();

  const dialog = page.getByRole("dialog", { name: "Nouvelle tâche" });
  await dialog.locator("#task-title").fill(title);
  await dialog.locator("#task-description").fill("Merci de vérifier sur place.");
  await dialog.getByRole("radio", { name: "Autre adresse mail" }).click();
  await dialog.getByLabel("Adresse mail de l'agent").fill(assertTestRecipient(to));
  await dialog.getByLabel("Nom de l'agent").fill("Agent E2E");
  await dialog.getByRole("button", { name: "Créer et envoyer" }).click();
  await expect(toastLocator(page, "l'agent affecté a été prévenu par mail")).toBeVisible({ timeout: 60_000 });

  // ── Le mail : vraiment arrivé, avec le bon contenu ──
  const mail = await waitForMail(outgoing, title);
  expect(mail, "le mail de la tâche n'est pas arrivé dans la boîte de test").not.toBeNull();
  expect(mail!.to).toContain(to);
  expect(mail!.text).toContain(title);
  expect(mail!.text).toContain("Bonjour Agent E2E");
  const link = mail!.text.match(/https?:\/\/[^\s]+\/tache\/([A-Za-z0-9_-]{43})/);
  expect(link, "lien /tache/:token absent du mail").not.toBeNull();
  const token = link![1];

  // ── Le destinataire ouvre le lien (session vierge, sans compte) ──
  const anon = await browser.newContext({ locale: "fr-FR", baseURL: "http://localhost:8080" });
  const p2 = await anon.newPage();
  await p2.goto(`/tache/${token}`);
  await expect(p2.getByRole("heading", { name: title })).toBeVisible({ timeout: 20_000 });
  // Ouvrir la page ne clôt rien (scanners de liens) : la tâche est toujours ouverte
  const { data: before } = await adminClient().from("action_tickets").select("status").eq("courier_id", courierId).eq("title", title).single();
  expect((before as { status: string }).status).not.toBe("done");
  await p2.getByLabel(/Note/).fill("Fait par l'E2E.");
  await p2.getByRole("button", { name: "Marquer comme terminée" }).click();
  await expect(p2.getByText("Tâche terminée")).toBeVisible({ timeout: 20_000 });
  await expect(p2.getByText(/Fait par l'E2E/)).toBeVisible();
  // Le lien ne donne ni l'objet du courrier ni l'usager
  await expect(p2.getByText(/courrier pour tâche/)).toHaveCount(0);
  await anon.close();

  // ── Côté agent : la tâche apparaît terminée ──
  await page.reload();
  await page.getByRole("tab", { name: /Actions liées/ }).click();
  await expect(page.getByText(title).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Rouvrir" })).toBeVisible({ timeout: 20_000 });
});

test("tâche : un lien inventé est refusé", async ({ page }) => {
  await page.goto(`/tache/${"A".repeat(43)}`);
  await expect(page.getByText("Lien introuvable")).toBeVisible({ timeout: 20_000 });
});

test("tâche : un consultant ne peut pas en créer (bouton désactivé)", async ({ page, needAdmin }) => {
  needAdmin();
  const courierId = await insertInboundCourier({
    organizationId: fx.alpha.orgId,
    subject: uniq("courrier tâche consultant"),
    socleOrganizationId: fx.alpha.subSocleOrgId,
    assignedService: "[TEST] Cabinet Alpha",
    workflowStateId: fx.alpha.states.processing,
  });
  await loginAs(page, fx.users.consultantAlpha, fx.password);
  await page.goto(`/courrier/${courierId}`);
  await page.getByRole("tab", { name: /Actions liées/ }).click();
  await expect(page.getByRole("button", { name: /^Créer/ })).toBeDisabled();
});
