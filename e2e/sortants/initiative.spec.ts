import type { Page } from "@playwright/test";
import { loadFixtures, loginAs, uniq, userClient, toastLocator } from "../helpers";
import { test, expect } from "../support/fixtures";
import { adminClient } from "../support/admin";
import { testRecipient, waitForMail } from "../support/mailbox";

// ═══ Courrier sortant à l'initiative de la collectivité : rédaction (assistant
// sur consigne), visa, signature, envoi — circuit « Direction » (workflow complet).
// Décor : le sortant est créé par la RPC `create_outbound_courier` avec les droits
// d'un gestionnaire, avec un destinataire dont l'adresse est une adresse de test
// (la sélection d'un contact RÉEL du Socle est un prérequis externe, voir fixme).

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

test.fixme("création par la fenêtre « Nouveau courrier » avec un destinataire choisi dans le référentiel du Socle — BLOQUÉ : il faut un contact de test dans le Socle (racine [TEST]) avec une adresse @example.test ; fournir son nom (E2E_SOCLE_CONTACT) à Laurent/Socle", async () => {
  // Parcours : /courriers-sortants → « Nouveau courrier » → organisation émettrice → ContactPicker → mode d'envoi → objet → Créer.
});
