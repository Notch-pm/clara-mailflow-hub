import { test, expect } from "@playwright/test";
import { loadFixtures, loginAs } from "./helpers";

// ═══ Parcours critique n°2 : droits d'un simple membre.
// membre.alpha appartient uniquement à la sous-organisation « [TEST] Cabinet Alpha » :
// il voit les courriers de SA sous-org + les non-assignés, pas ceux des autres
// organisations du tenant, et jamais les données d'un autre tenant.
// Lecture seule : rejouable sans re-seed.

const fx = loadFixtures();

test.beforeEach(async ({ page }) => {
  await loginAs(page, fx.users.membreAlpha, fx.password);
});

test("boîte aux lettres : uniquement sa sous-organisation + non-assignés", async ({ page }) => {
  await page.goto("/boite-aux-lettres");

  await expect(page.getByText("[TEST] Courrier Alpha assigné cabinet").first()).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText("[TEST] Courrier Alpha non assigné").first()).toBeVisible();

  // Courrier de la racine (organisation dont il n'est PAS membre) : invisible
  await expect(page.getByText("[TEST] Courrier Alpha racine")).toHaveCount(0);
  // Données de l'autre tenant : invisibles
  await expect(page.getByText(/\[TEST\] Courrier Beta/)).toHaveCount(0);
});

test("paramètres : accès réservé aux administrateurs", async ({ page }) => {
  await page.goto("/parametres");
  await expect(page.getByText("Accès réservé").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Organisations")).toHaveCount(0);
});

test("recherche : aucune donnée d'un autre tenant ni d'une autre organisation", async ({ page }) => {
  await page.goto("/recherche");
  const input = page.getByPlaceholder(/Rechercher dans les objets/);
  await input.fill("[TEST] Courrier");
  await page.waitForTimeout(1500); // debounce de la recherche

  await expect(page.getByText(/\[TEST\] Courrier Beta/)).toHaveCount(0);
  await expect(page.getByText("[TEST] Courrier Alpha racine")).toHaveCount(0);
});
