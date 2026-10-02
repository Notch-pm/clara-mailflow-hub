import { test, expect } from "@playwright/test";
import { loadFixtures, loginAs } from "./helpers";

// ═══ Parcours critique n°2 : droits d'un simple membre.
// membre.alpha appartient uniquement à la sous-organisation « [TEST] Cabinet Alpha » :
// il voit les courriers de SA sous-org + les non-assignés, pas ceux des autres
// organisations du tenant, et jamais les données d'un autre tenant.
// Depuis le 2026-10-01, les non-assignés vivent dans « Courrier entrant »
// (service courrier) : le membre les retrouve par la recherche, plus dans la
// boîte aux lettres.
// Lecture seule : rejouable sans re-seed.

const fx = loadFixtures();

test.beforeEach(async ({ page }) => {
  await loginAs(page, fx.users.membreAlpha, fx.password);
});

test("À instruire : uniquement sa sous-organisation", async ({ page }) => {
  await page.goto("/a-instruire");

  await expect(page.getByText("[TEST] Courrier Alpha assigné cabinet").first()).toBeVisible({
    timeout: 15_000,
  });

  // Courrier de la racine (organisation dont il n'est PAS membre) : invisible —
  // ni dans la liste, ni dans les « Courriers liés » suggérés du panneau, qui
  // le laissaient passer jusqu'au 2026-10-01.
  await expect(page.getByText("Courriers liés").first()).toBeVisible();
  await expect(page.getByText("[TEST] Courrier Alpha racine")).toHaveCount(0);
  // Données de l'autre tenant : invisibles
  await expect(page.getByText(/\[TEST\] Courrier Beta/)).toHaveCount(0);
});

test("paramètres : accès réservé aux administrateurs", async ({ page }) => {
  await page.goto("/parametres");
  await expect(page.getByText("Accès réservé").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Organisations")).toHaveCount(0);
});

test("recherche : sa sous-organisation et les non-assignés, rien d'autre", async ({ page }) => {
  // La recherche lit `?q=` (le champ vit dans le panneau « Filtres »).
  await page.goto(`/recherche?q=${encodeURIComponent("[TEST] Courrier")}`);

  await expect(page.getByText("[TEST] Courrier Alpha assigné cabinet").first()).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText("[TEST] Courrier Alpha non assigné").first()).toBeVisible();

  await expect(page.getByText(/\[TEST\] Courrier Beta/)).toHaveCount(0);
  await expect(page.getByText("[TEST] Courrier Alpha racine")).toHaveCount(0);
});
