import { test, expect } from "@playwright/test";
import { loadFixtures, loginAs } from "./helpers";

// ═══ Parcours critique n°3 : étanchéité entre tenants, côté interface.
// (L'isolation RLS est prouvée par la suite d'intégration ; ici on vérifie
// qu'aucune donnée d'un autre tenant ne fuit à travers l'UI et ses caches.)

const fx = loadFixtures();

test("un admin du tenant Beta ne voit jamais les données du tenant Alpha", async ({ page }) => {
  await loginAs(page, fx.users.adminBeta, fx.password);

  await page.goto("/a-instruire");
  await expect(page.getByText(/\[TEST\] Courrier Beta/).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/\[TEST\] Courrier Alpha/)).toHaveCount(0);
  await expect(page.getByText(fx.alpha.name)).toHaveCount(0);

  // Paramètres → Organisations : l'arbre ne contient que les orgs Beta
  await page.goto("/parametres");
  await page.getByText("Organisations", { exact: true }).first().click();
  await expect(page.getByText("[TEST] Cabinet Beta").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("[TEST] Cabinet Alpha")).toHaveCount(0);

  // Recherche plein texte : rien du tenant Alpha
  // (la recherche lit `?q=` ; le champ vit dans le panneau « Filtres »)
  await page.goto(`/recherche?q=${encodeURIComponent("[TEST] Courrier")}`);
  await expect(page.getByText(/\[TEST\] Courrier Beta/).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/\[TEST\] Courrier Alpha/)).toHaveCount(0);
});
