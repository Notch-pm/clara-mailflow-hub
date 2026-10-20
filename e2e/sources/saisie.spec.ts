import { loadFixtures, loginAs, uniq } from "../helpers";
import { test, expect } from "../support/fixtures";
import { Boite } from "../pages/boite";
import { courrierTypePdf } from "../support/files";

// ═══ Source « saisie unitaire » : sans pièce (manuelle) et avec pièce analysée par OCR/IA
// (via le guichet IA du Socle — jamais de fournisseur direct). Les contenus de
// l'IA ne sont pas déterministes : on vérifie la présence et la structure, pas le texte.

const fx = loadFixtures();

test.beforeEach(async ({ page }) => {
  await loginAs(page, fx.users.adminAlpha, fx.password);
});

test("saisie sans OCR : le courrier créé apparaît avec l'objet saisi", async ({ page }) => {
  const subject = uniq("saisie manuelle");
  const boite = new Boite(page);
  await boite.open();
  await boite.openNewCourier();
  await page.getByRole("button", { name: "Saisir manuellement" }).click();
  await page.locator("#nc-subject").fill(subject);
  await page.locator("#nc-service").click();
  await page.getByRole("option", { name: fx.alpha.name }).first().click();
  await page.getByRole("button", { name: "Créer", exact: true }).click();
  await expect(page.getByText(subject).first()).toBeVisible({ timeout: 20_000 });
});

test("saisie : l'objet est obligatoire (aucun courrier créé sans)", async ({ page }) => {
  const boite = new Boite(page);
  await boite.open();
  await boite.openNewCourier();
  await page.getByRole("button", { name: "Saisir manuellement" }).click();
  await page.getByRole("button", { name: "Créer", exact: true }).click();
  // Le dialogue reste ouvert : la validation a refusé
  await expect(page.locator("#nc-subject")).toBeVisible();
  await expect(page.getByRole("dialog", { name: /Nouveau courrier/ })).toBeVisible();
});

test("saisie avec OCR : pièce PDF analysée, champs pré-remplis, analyse visible sur le courrier", async ({ page }) => {
  test.setTimeout(240_000);
  const marker = `E2E${Date.now().toString(36)}`;
  const boite = new Boite(page);
  await boite.open();
  await boite.openNewCourier();

  // Dépôt réel du fichier via le champ de téléversement du dialogue
  await page.locator('input[type="file"]').setInputFiles({
    name: `courrier-${marker}.pdf`,
    mimeType: "application/pdf",
    buffer: courrierTypePdf(marker),
  });
  await expect(page.getByText(`courrier-${marker}.pdf`).first()).toBeVisible();
  await page.getByRole("button", { name: "Continuer" }).click();

  // L'analyse passe par le Socle : on attend la fin (étape 2) ou un refus explicite
  const subjectField = page.locator("#nc-subject");
  await expect(subjectField.or(page.getByText("Analyse impossible"))).toBeVisible({ timeout: 180_000 });
  await expect(page.getByText("Analyse impossible"), "l'analyse OCR/IA a échoué").toHaveCount(0);

  // Pré-remplissage : un objet non vide est proposé (valeur exacte non testée)
  await expect(subjectField).not.toHaveValue("");
  const subject = `${uniq("saisie OCR")} ${await subjectField.inputValue()}`.slice(0, 190);
  await subjectField.fill(subject);
  await page.locator("#nc-service").click();
  await page.getByRole("option", { name: fx.alpha.name }).first().click();
  await page.getByRole("button", { name: "Créer", exact: true }).click();
  await expect(page.getByText(subject).first()).toBeVisible({ timeout: 30_000 });

  // Fiche complète : pièce jointe, et analyse IA (résumé, actions suggérées) déjà là
  await page.getByText(subject).first().click();
  await page.getByRole("button", { name: "Ouvrir en plein écran" }).click();
  await expect(page).toHaveURL(/\/courrier\//);
  await expect(page.getByText(`courrier-${marker}.pdf`).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "Ce que demande l'usager" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Résumé et actions détectés par l'analyse/)).toBeVisible();
  // Détail de l'analyse : résumé + actions suggérées présents (texte non vérifié)
  await page.getByRole("button", { name: /Détail de l'analyse/ }).click();
  await expect(page.getByText("Résumé", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Actions suggérées").first()).toBeVisible();
});
