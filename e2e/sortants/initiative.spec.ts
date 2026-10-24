import type { Page } from "@playwright/test";
import { loadFixtures, loginAs, uniq, userClient, toastLocator } from "../helpers";
import { test, expect } from "../support/fixtures";
import { adminClient } from "../support/admin";
import { testRecipient, waitForMail } from "../support/mailbox";

// ═══ Courrier sortant à l'initiative de la collectivité : rédaction (assistant
// sur consigne), visa, signature, envoi — circuit « Direction » (workflow complet).
// Décor : le sortant est créé par la RPC `create_outbound_courier` avec les droits
// d'un gestionnaire, avec un destinataire dont l'adresse est une adresse de test
// (le choix dans le référentiel du Socle est couvert par le dernier test).

const fx = loadFixtures();
test.describe.configure({ mode: "serial" });

let outboundId = "";
const subject = uniq("sortant initiative");
const recipientEmail = testRecipient("sortant");
const MARK = `Mention E2E ${Date.now().toString(36)}`;

async function as(page: Page, email: string) {
  await page.context().clearCookies();
  await page.addInitScript(() => window.localStorage.clear());
  await loginAs(page, email, fx.password, fx.alpha.orgId);
}
async function openRedaction(page: Page) {
  await page.goto(`/courrier/${outboundId}`);
  await page.getByRole("tab", { name: "Rédaction" }).click();
}

test("préparation : un sortant à l'état « En rédaction » à la Direction", async ({ needMail }) => {
  needMail();
  const gestionnaire = await userClient(fx.users.gestionnaireAlpha, fx.password);
  const { data, error } = await gestionnaire.rpc("create_outbound_courier", {
    p_organization_id: fx.alpha.orgId,
    p_socle_organization_id: fx.alpha.fullSocleOrgId,
    p_channel: "email",
    p_subject: subject,
    p_recipient: { socle_contact_id: crypto.randomUUID(), name: "Destinataire E2E", email: recipientEmail },
  });
  expect(error).toBeNull();
  outboundId = data as string;
  const { data: row } = await adminClient().from("couriers").select("workflow_state_id, direction").eq("id", outboundId).single();
  expect(row).toMatchObject({ direction: "outbound", workflow_state_id: fx.alpha.fullReplyStates.draft });
});

test("rédaction : l'assistant rédige sur consigne, l'agent complète et soumet au visa", async ({ page, needMail }) => {
  needMail();
  test.setTimeout(240_000);
  await as(page, fx.users.gestionnaireAlpha);
  await openRedaction(page);
  await page.getByLabel("Que doit dire ce courrier ?").fill("Convoquer le destinataire à la réunion de quartier du 12 novembre à 18 h, salle B. Ton cordial.");
  await page.getByRole("button", { name: "Rédiger avec l'assistant" }).click();
  const editor = page.locator('[contenteditable="true"]').first();
  await expect(async () => {
    expect((await editor.innerText()).trim().length).toBeGreaterThan(20);
  }, "l'assistant n'a produit aucun texte").toPass({ timeout: 150_000 });
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(` ${MARK}`);
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(toastLocator(page, "Brouillon enregistré")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Soumettre au visa" }).click();
  await expect(async () => {
    const { data } = await adminClient().from("couriers").select("workflow_state_id").eq("id", outboundId).single();
    expect((data as { workflow_state_id: string }).workflow_state_id).toBe(fx.alpha.fullReplyStates.visa);
  }).toPass({ timeout: 20_000 });
});

test("visa : le viseur vise depuis « Courrier sortant » ; un gestionnaire ordinaire ne le peut pas", async ({ page, needMail }) => {
  needMail();
  await as(page, fx.users.gestionnaireAlpha);
  await openRedaction(page);
  const viser = page.getByRole("button", { name: /^Viser/ });
  await expect(viser).toBeVisible({ timeout: 20_000 });
  await expect(viser).toBeDisabled();

  await as(page, fx.users.viseurAlpha);
  await openRedaction(page);
  await page.getByRole("button", { name: /^Viser/ }).click();
  await expect(async () => {
    const { data } = await adminClient().from("couriers").select("workflow_state_id").eq("id", outboundId).single();
    expect((data as { workflow_state_id: string }).workflow_state_id).toBe(fx.alpha.fullReplyStates.signature);
  }).toPass({ timeout: 30_000 });
});

test("signature puis envoi : le courriel part au destinataire, lu dans la boîte de test", async ({ page, needMail }) => {
  const { outgoing } = needMail();
  test.setTimeout(180_000);
  await as(page, fx.users.signataireAlpha);
  await openRedaction(page);
  await page.getByRole("button", { name: /^Signer/ }).click();
  await expect(async () => {
    const { data } = await adminClient().from("couriers").select("workflow_state_id").eq("id", outboundId).single();
    expect((data as { workflow_state_id: string }).workflow_state_id).toBe(fx.alpha.fullReplyStates.send);
  }).toPass({ timeout: 30_000 });

  await as(page, fx.users.gestionnaireAlpha);
  await openRedaction(page);
  await page.getByRole("button", { name: /^Envoyer/ }).click();
  await expect(toastLocator(page, /Courriel envoyé à/)).toBeVisible({ timeout: 60_000 });

  const mail = await waitForMail(outgoing, "", { to: recipientEmail });
  expect(mail, "le courriel du sortant n'est pas arrivé").not.toBeNull();
  expect(mail!.to).toContain(recipientEmail);
  // L'assistant propose son propre objet : celui du courriel est celui enregistré sur le courrier
  const { data: sent } = await adminClient().from("couriers").select("subject").eq("id", outboundId).single();
  const finalSubject = (sent as { subject: string }).subject;
  expect(mail!.subject).toBe(finalSubject);
  expect(mail!.html + mail!.text).toContain(MARK);

  // « Courriers sortants » : il apparaît dans « Envoyés » (l'administrateur voit tout le tenant)
  await as(page, fx.users.adminAlpha);
  await page.goto("/courriers-sortants?vue=envoyes");
  await expect(page.getByText(finalSubject).first()).toBeVisible({ timeout: 20_000 });
});

// Contact PERSISTANT du référentiel de la racine [TEST] du Socle (créé le
// 2026-10-24, hors reseed : le Socle n'est pas purgé par `seed:test`).
const SOCLE_CONTACT = { search: "E2E Sortant", email: "e2e-sortant@example.test" };

test("création par la fenêtre « Nouveau courrier » avec un destinataire choisi dans le référentiel", async ({ page, needAdmin }) => {
  needAdmin();
  const newSubject = uniq("sortant référentiel");
  await as(page, fx.users.gestionnaireAlpha);
  await page.goto("/courriers-sortants");
  await page.getByRole("button", { name: "Nouveau courrier" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Nouveau courrier sortant" });
  await expect(dialog).toBeVisible();

  await dialog.locator("#outbound-issuer").click();
  await page.getByRole("option", { name: "[TEST] Cabinet Alpha" }).click();

  await dialog.getByRole("combobox").filter({ hasText: "Sélectionner un contact" }).click();
  await page.getByPlaceholder("Rechercher par nom…").fill(SOCLE_CONTACT.search);
  await page.getByRole("option", { name: new RegExp(SOCLE_CONTACT.search) }).first().click();

  await dialog.getByLabel(/^Courriel/).check();
  await expect(dialog.getByText(SOCLE_CONTACT.email)).toBeVisible();
  await dialog.locator("#outbound-subject").fill(newSubject);
  await dialog.getByRole("button", { name: "Créer et rédiger" }).click();

  await expect(page).toHaveURL(/\/courrier\/[0-9a-f-]{36}/, { timeout: 20_000 });
  const id = page.url().match(/\/courrier\/([0-9a-f-]{36})/)![1];
  const { data: row } = await adminClient().from("couriers")
    .select("direction, channel, subject, socle_organization_id").eq("id", id).single();
  expect(row).toMatchObject({ direction: "outbound", channel: "email", subject: newSubject, socle_organization_id: fx.alpha.subSocleOrgId });
  const { data: parts } = await adminClient().from("courier_participants")
    .select("role, email, socle_contact_id").eq("courier_id", id).eq("role", "recipient");
  expect(parts).toHaveLength(1);
  expect(parts![0]).toMatchObject({ email: SOCLE_CONTACT.email });
  expect(parts![0].socle_contact_id).toBeTruthy();
});
