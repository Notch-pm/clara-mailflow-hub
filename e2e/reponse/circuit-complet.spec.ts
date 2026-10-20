import type { Page } from "@playwright/test";
import { loadFixtures, loginAs, uniq, toastLocator } from "../helpers";
import { test, expect } from "../support/fixtures";
import { adminClient, insertInboundCourier } from "../support/admin";
import { testRecipient, waitForMail } from "../support/mailbox";

// ═══ Réponse, de bout en bout, avec les BONS acteurs :
//   gestionnaire : rédige (brouillon IA + édition) et soumet au visa
//   viseur       : vise dans le parapheur
//   signataire   : signe dans le parapheur
//   gestionnaire : envoie (courriel réellement lu dans la boîte de test)
//   gestionnaire : clôture puis archive le courrier d'origine
// Workflows « circuit complet » de l'organisation « [TEST] Direction Alpha ».

const fx = loadFixtures();

test.describe.configure({ mode: "serial" });

let courierId = "";
let replyId = "";
const subject = uniq("circuit réponse");
const sender = testRecipient("usager-circuit");
const BODY_MARK = `Texte E2E ${Date.now().toString(36)}`;

async function as(page: Page, email: string) {
  await page.context().clearCookies();
  await page.addInitScript(() => window.localStorage.clear());
  await loginAs(page, email, fx.password, fx.alpha.orgId);
}

test("préparation : un courrier en instruction à la Direction, expéditeur joignable", async ({ needMail }) => {
  needMail();
  courierId = await insertInboundCourier({
    organizationId: fx.alpha.orgId,
    subject,
    socleOrganizationId: fx.alpha.fullSocleOrgId,
    assignedService: "[TEST] Direction Alpha",
    workflowStateId: fx.alpha.fullStates.processing,
    senderEmail: sender,
    senderName: "Usager Circuit",
  });
  expect(courierId).toBeTruthy();
});

test("rédaction : brouillon généré par l'IA, puis édité et enregistré", async ({ page, needMail }) => {
  needMail();
  test.setTimeout(240_000);
  await as(page, fx.users.adminAlpha);
  await page.goto(`/courrier/${courierId}`);
  await page.getByRole("tab", { name: /Réponses?/ }).click();
  await page.getByRole("button", { name: "Créer une réponse" }).click();

  // Assistant IA (guichet du Socle) : type « Suivi » + consigne, puis génération
  await page.getByRole("button", { name: /Assistant IA/ }).click();
  await page.getByRole("button", { name: "Suivi", exact: true }).click();
  await page.getByPlaceholder(/Mentionner le délai/).fill("Ton cordial, réponse courte.");
  await page.getByRole("button", { name: "Générer la réponse" }).click();
  const editor = page.locator('[contenteditable="true"]').first();
  await expect(async () => {
    expect((await editor.innerText()).trim().length).toBeGreaterThan(20);
  }, "l'assistant IA n'a produit aucun brouillon").toPass({ timeout: 150_000 });

  // Édition manuelle : on ajoute une phrase repérable
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(` ${BODY_MARK}`);
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(toastLocator(page, "Brouillon enregistré")).toBeVisible({ timeout: 20_000 });

  const { data } = await adminClient().from("couriers").select("id, metadata").eq("parent_courier_id", courierId).eq("direction", "outbound").single();
  replyId = (data as { id: string }).id;
  expect(JSON.stringify((data as { metadata: unknown }).metadata)).toContain(BODY_MARK);
});

test("soumission : le gestionnaire envoie la réponse au visa", async ({ page, needMail }) => {
  needMail();
  await as(page, fx.users.adminAlpha);
  await page.goto(`/courrier/${courierId}`);
  await page.getByRole("tab", { name: /Réponses?/ }).click();
  await page.getByRole("button", { name: "Modifier la réponse n°1" }).click();
  await page.getByRole("button", { name: "Soumettre au visa" }).click();
  await expect(toastLocator(page, "État mis à jour")).toBeVisible({ timeout: 20_000 });
  const { data } = await adminClient().from("couriers").select("workflow_state_id").eq("id", replyId).single();
  expect((data as { workflow_state_id: string }).workflow_state_id).toBe(fx.alpha.fullReplyStates.visa);
});

test("visa : seul le viseur vise (le signataire n'a pas le geste), depuis le parapheur", async ({ page, needMail }) => {
  needMail();
  // Le signataire (non viseur) n'a pas d'onglet « À viser » utile : il ne peut pas viser
  await as(page, fx.users.signataireAlpha);
  await page.goto(`/parapheur?onglet=visa&reponse=${replyId}`);
  await expect(page.getByRole("button", { name: /^Viser/ })).toHaveCount(0);

  const viseurPage = await page.context().newPage();
  await as(viseurPage, fx.users.viseurAlpha);
  await viseurPage.goto(`/parapheur?onglet=visa&reponse=${replyId}`);
  await viseurPage.getByPlaceholder("Commentaire de visa (facultatif)").fill("Vu, bon pour signature.");
  await viseurPage.getByRole("button", { name: /^Viser/ }).click();
  await expect(async () => {
    const { data } = await adminClient().from("couriers").select("workflow_state_id").eq("id", replyId).single();
    expect((data as { workflow_state_id: string }).workflow_state_id).toBe(fx.alpha.fullReplyStates.signature);
  }).toPass({ timeout: 30_000 });
  // Le visa est tracé avec son auteur et son commentaire
  const { data: visas } = await adminClient().from("courier_visas").select("*").eq("courier_id", replyId);
  expect(visas?.length).toBe(1);
  expect(JSON.stringify(visas)).toContain("Vu, bon pour signature.");
});

test("signature : la réponse d'un gestionnaire arrive dans « À signer » du signataire unique de l'organisation", async ({ page, needMail }) => {
  needMail();
  test.fail(true, "DÉFAUT connu (voir rapport) : le brouillon d'un non-signataire naît sans signatory_id ; avec un seul signataire dans l'organisation, aucune désignation n'est proposée et la réponse n'entre jamais dans la file du parapheur.");
  await as(page, fx.users.signataireAlpha);
  await page.goto(`/parapheur?onglet=signature&reponse=${replyId}`);
  await expect(page.getByRole("button", { name: /^Signer/ })).toBeVisible({ timeout: 10_000 });
});

test("signature : seul le signataire signe (depuis la réponse), le viseur ne le peut pas", async ({ page, needMail }) => {
  needMail();
  const open = async (email: string) => {
    await as(page, email);
    await page.goto(`/courrier/${courierId}`);
    await page.getByRole("tab", { name: /Réponses?/ }).click();
    await page.getByRole("button", { name: /(Modifier|Consulter) la réponse n°1/ }).click();
  };
  // Le viseur (non signataire) : le bouton de signature est grisé, avec sa raison
  await open(fx.users.viseurAlpha);
  const signBtn = page.getByRole("button", { name: /^Signer/ });
  await expect(signBtn).toBeVisible({ timeout: 20_000 });
  await expect(signBtn).toBeDisabled();

  await open(fx.users.signataireAlpha);
  await page.getByRole("button", { name: /^Signer/ }).click();
  await expect(async () => {
    const { data } = await adminClient().from("couriers").select("workflow_state_id, metadata").eq("id", replyId).single();
    const d = data as { workflow_state_id: string; metadata: { signed_at?: string; signed_by?: string } };
    expect(d.workflow_state_id).toBe(fx.alpha.fullReplyStates.send);
    expect(d.metadata.signed_at).toBeTruthy();
  }).toPass({ timeout: 30_000 });
});

test("envoi : le courriel part, lu dans la boîte de test (destinataire, contenu, signature)", async ({ page, needMail }) => {
  const { outgoing } = needMail();
  test.setTimeout(180_000);
  await as(page, fx.users.adminAlpha);
  await page.goto(`/courrier/${courierId}`);
  await page.getByRole("tab", { name: /Réponses?/ }).click();
  await page.getByRole("button", { name: "Modifier la réponse n°1" }).click();
  await page.getByRole("button", { name: /^Envoyer/ }).click();
  await expect(toastLocator(page, /Courriel envoyé à/)).toBeVisible({ timeout: 60_000 });

  const { data: rep } = await adminClient().from("couriers").select("subject, workflow_state_id").eq("id", replyId).single();
  const replySubject = (rep as { subject: string }).subject;
  expect((rep as { workflow_state_id: string }).workflow_state_id).toBe(fx.alpha.fullReplyStates.done);

  const mail = await waitForMail(outgoing, replySubject.slice(0, 40));
  expect(mail, "la réponse n'est pas arrivée dans la boîte de test").not.toBeNull();
  expect(mail!.to).toContain(sender);
  expect(mail!.html + mail!.text).toContain(BODY_MARK);
  expect(mail!.html).toMatch(/Signataire Alpha|DGS de test|<img/); // bloc de signature apposé
});

test("clôture puis archivage du courrier d'origine", async ({ page, needMail }) => {
  needMail();
  await as(page, fx.users.adminAlpha);
  await page.goto(`/courrier/${courierId}`);
  await page.getByRole("button", { name: "Clôturer" }).click();
  await expect(page.getByText("Traité", { exact: true }).first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Archiver" }).click();
  await expect(async () => {
    const { data } = await adminClient().from("couriers").select("workflow_state_id").eq("id", courierId).single();
    expect((data as { workflow_state_id: string }).workflow_state_id).toBe(fx.alpha.fullStates.archived);
  }).toPass({ timeout: 20_000 });
  // Il rejoint « Courriers archivés »
  await page.goto("/courriers-archives");
  await expect(page.getByText(subject).first()).toBeVisible({ timeout: 20_000 });
});
