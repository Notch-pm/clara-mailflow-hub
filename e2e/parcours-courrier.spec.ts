import { test, expect, type Page } from "@playwright/test";
import { loadFixtures, loginAs } from "./helpers";

// ═══ Parcours critique n°1 : cycle de vie complet d'un courrier —
// saisie manuelle → instruction via le workflow → clôture → brouillon de réponse.
// Le test crée SON propre courrier (sujet unique) : rejouable à volonté.

const fx = loadFixtures();
const SUBJECT = `[TEST] E2E parcours ${Date.now()}`;

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  await loginAs(page, fx.users.adminAlpha, fx.password);
});

async function openBoiteAuxLettres(page: Page) {
  await page.goto("/a-instruire");
  await expect(page.getByRole("button", { name: /Ajouter du courrier/ })).toBeVisible();
}

test("saisie : création manuelle d'un courrier avec organisation gestionnaire", async ({ page }) => {
  await openBoiteAuxLettres(page);

  // « Ajouter du courrier » est un menu (saisie / import en masse) depuis le 2026-10-01.
  await page.getByRole("button", { name: /Ajouter du courrier/ }).click();
  await page.getByRole("menuitem", { name: /Saisir un courrier/ }).click();
  await page.getByRole("button", { name: "Saisir manuellement" }).click();

  await page.locator("#nc-subject").fill(SUBJECT);
  // Organisation gestionnaire (Select shadcn)
  await page.locator("#nc-service").click();
  // L'option affiche « <org> — <workflow> » : match sur le nom d'org seul
  await page.getByRole("option", { name: fx.alpha.name }).click();

  await page.getByRole("button", { name: "Créer", exact: true }).click();

  // Le courrier apparaît dans la boîte aux lettres
  await expect(page.getByText(SUBJECT).first()).toBeVisible({ timeout: 15_000 });
});

test("instruction : transitions du workflow jusqu'à l'état final", async ({ page }) => {
  await openBoiteAuxLettres(page);

  // Ouvre le courrier créé au test précédent (le panneau peut basculer en
  // pleine page après transition : sélecteurs au niveau page)
  await page.getByText(SUBJECT).first().click();
  await expect(page.getByText(SUBJECT).first()).toBeVisible();

  // Reçu → En instruction
  await page.getByRole("button", { name: "Instruire" }).click();
  await expect(page.getByText("En instruction").first()).toBeVisible({ timeout: 15_000 });

  // En instruction → Traité
  await page.getByRole("button", { name: "Clôturer" }).click();
  await expect(page.getByText("Traité", { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Clôturer" })).toHaveCount(0);
});

test("réponse : création d'un brouillon rattaché au courrier", async ({ page }) => {
  // Page détail (les onglets n'existent pas dans le panneau de la boîte aux lettres)
  // sur un courrier seedé à l'état initial, workflow réponse configuré sur son org.
  await page.goto(`/courrier/${fx.alpha.couriers.root}`);
  await expect(page.getByText("[TEST] Courrier Alpha racine").first()).toBeVisible({
    timeout: 15_000,
  });

  // Ni action ni réponse depuis la boîte aux lettres (2026-09-24) : le
  // courrier seedé est à l'état initial, on le passe d'abord en instruction.
  await page.getByRole("button", { name: "Instruire" }).click();
  await expect(page.getByText("En instruction").first()).toBeVisible({ timeout: 15_000 });

  // Onglet Réponse
  await page.getByRole("tab", { name: /Réponses?/ }).click();
  await page.getByRole("button", { name: "Créer une réponse" }).click();

  // Éditeur : saisie dans le corps (tiptap = contenteditable)
  const editor = page.locator('[contenteditable="true"]').first();
  await editor.click();
  await editor.fill("Réponse de test E2E — merci de votre courrier.");

  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();

  // Le brouillon existe (on reste dans l'éditeur après enregistrement)
  await expect(page.getByText("Réponse n°1").first()).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Retour", exact: true }).click();
  await expect(page.getByText(/\d+ réponses?/).first()).toBeVisible({ timeout: 15_000 });
});
