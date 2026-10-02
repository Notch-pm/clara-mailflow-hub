import { test, expect } from "@playwright/test";
import { loadFixtures, loginAs } from "./helpers";

// ═══ Parcours : rôle `consultant` en LECTURE SEULE.
// consultant.alpha appartient à la sous-organisation « [TEST] Cabinet Alpha » :
// il VOIT les courriers de son périmètre (comme un membre) mais ne dispose
// d'AUCUNE action d'écriture (création, import), garde l'accès aux écrans de
// consultation (statistiques), et les paramètres lui restent fermés.
// Le blocage serveur (RLS is_editor_of) est couvert par droits-roles.itest.ts ;
// ici on valide le masquage UI. Lecture seule, rejouable sans re-seed.

const fx = loadFixtures();

test.beforeEach(async ({ page }) => {
  await loginAs(page, fx.users.consultantAlpha, fx.password);
});

test("À instruire : voit ses courriers, aucun bouton création/import", async ({ page }) => {
  await page.goto("/a-instruire");

  // Parité de lecture avec un membre : sa sous-org + les non-assignés
  await expect(page.getByText("[TEST] Courrier Alpha assigné cabinet").first()).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText("[TEST] Courrier Alpha non assigné").first()).toBeVisible();

  // Actions d'écriture masquées
  await expect(page.getByRole("button", { name: /Nouveau courrier/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Importer en masse/i })).toHaveCount(0);
});

test("import en masse : page en lecture seule (pas d'assistant)", async ({ page }) => {
  await page.goto("/import-en-masse");
  await expect(page.getByText(/lecture seule/i).first()).toBeVisible({ timeout: 15_000 });
});

test("paramètres : accès réservé aux administrateurs", async ({ page }) => {
  await page.goto("/parametres");
  await expect(page.getByText("Accès réservé").first()).toBeVisible({ timeout: 15_000 });
});

test("statistiques : restent accessibles au consultant (lecture)", async ({ page }) => {
  await page.goto("/statistiques");
  // La page de stats n'affiche pas le garde « Accès réservé » pour un consultant
  await expect(page.getByText("Accès réservé")).toHaveCount(0);
});
