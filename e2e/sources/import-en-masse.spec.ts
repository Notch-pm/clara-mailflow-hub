import { loadFixtures, loginAs, uniq } from "../helpers";
import { test, expect } from "../support/fixtures";
import { textPdf } from "../support/files";

// ═══ Source « import en masse » : assistant en 4 étapes (canal → documents →
// association → vérification). Deux fichiers, « 1 fichier = 1 courrier », puis
// confirmation : deux courriers distincts rattachés à l'organisation choisie.
// Les PDF ne portent aucun nom d'expéditeur : l'analyse ne doit créer aucune
// fiche dans le référentiel du Socle.

const fx = loadFixtures();

test("import en masse : 2 fichiers → 2 courriers rattachés à l'organisation", async ({ page }) => {
  test.setTimeout(300_000);
  await loginAs(page, fx.users.adminAlpha, fx.password);
  const t1 = uniq("masse A");
  const t2 = uniq("masse B");

  await page.goto("/a-instruire");
  await page.getByRole("button", { name: /Ajouter du courrier/ }).click();
  await page.getByRole("menuitem", { name: /Importer plusieurs courriers/ }).click();
  await expect(page).toHaveURL(/import-en-masse/);

  // 1. canal
  await page.getByRole("button", { name: /Courrier papier/ }).click();
  await page.getByRole("button", { name: "Suivant : Documents" }).click();

  // 2. documents
  await page.locator('input[type="file"]').setInputFiles([
    { name: "masse-a.pdf", mimeType: "application/pdf", buffer: textPdf(["Note de service numero un", "Aucun nom propre ici."]) },
    { name: "masse-b.pdf", mimeType: "application/pdf", buffer: textPdf(["Note de service numero deux", "Aucun nom propre ici."]) },
  ]);
  await expect(page.getByText("masse-a.pdf").first()).toBeVisible();
  await expect(page.getByText("masse-b.pdf").first()).toBeVisible();
  await page.getByRole("button", { name: "Suivant : Association" }).click();

  // 3. association
  await page.getByRole("button", { name: "1 fichier = 1 courrier" }).click();
  await page.getByRole("button", { name: "Passer à la vérification" }).click();

  // 4. vérification (l'analyse IA tourne, un courrier après l'autre)
  const titles = page.getByPlaceholder("Titre du courrier");
  await expect(titles).toHaveCount(2, { timeout: 30_000 });
  await expect(page.getByText(/Analyse en cours/)).toHaveCount(0, { timeout: 240_000 });
  await titles.nth(0).fill(t1);
  await titles.nth(1).fill(t2);
  for (let i = 0; i < 2; i++) {
    await page.getByLabel("Organisation gestionnaire").nth(i).click();
    await page.getByRole("option", { name: "[TEST] Cabinet Alpha" }).first().click();
  }
  await page.getByRole("button", { name: /Confirmer 2 courriers/ }).click();

  // 5. résultat
  await expect(page.getByText(/2 courriers créés/)).toBeVisible({ timeout: 120_000 });
  // Rattachés à une sous-organisation : ils n'attendent pas dans « À instruire » — on les retrouve par la recherche.
  await page.goto(`/recherche?q=${encodeURIComponent(t1)}`);
  await expect(page.getByText(t1).first()).toBeVisible({ timeout: 20_000 });
  await page.goto(`/recherche?q=${encodeURIComponent(t2)}`);
  await expect(page.getByText(t2).first()).toBeVisible({ timeout: 20_000 });
});
