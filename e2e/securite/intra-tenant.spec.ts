import { loadFixtures, loginAs, userClient } from "../helpers";
import { test, expect } from "../support/fixtures";

// ═══ Étanchéité entre ORGANISATIONS d'un même tenant (Cabinet / Service Technique /
// racine). Le filtre intra-tenant est UI-only (docs/permissions.md, « hors
// périmètre ») : les listes et la recherche sont filtrées, l'accès par URL
// directe et Storage ne le sont pas — ces deux cas sont marqués `test.fail`
// (DÉFAUT connu et documenté) : ils passeront « au rouge » le jour où le
// verrou serveur sera posé, signal pour retirer l'annotation.

const fx = loadFixtures();
const TECH = "[TEST] Courrier Alpha technique";
const CABINET = "[TEST] Courrier Alpha assigné cabinet";

test("listes : un membre du Cabinet ne voit pas le courrier du Service Technique", async ({ page }) => {
  await loginAs(page, fx.users.membreAlpha, fx.password);
  await page.goto("/a-instruire");
  await expect(page.getByText(CABINET).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(TECH)).toHaveCount(0);
  await expect(page.getByText("[TEST] Courrier Alpha racine")).toHaveCount(0);
});

test("recherche : même cloisonnement", async ({ page }) => {
  await loginAs(page, fx.users.membreAlpha, fx.password);
  await page.goto(`/recherche?q=${encodeURIComponent("[TEST] Courrier")}`);
  await expect(page.getByText(CABINET).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(TECH)).toHaveCount(0);
});

test("réciproque : le membre du Service Technique ne voit pas le Cabinet", async ({ page }) => {
  await loginAs(page, fx.users.techAlpha, fx.password);
  await page.goto("/a-instruire");
  await expect(page.getByText(TECH).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(CABINET)).toHaveCount(0);
  await expect(page.getByText("[TEST] Courrier Alpha racine")).toHaveCount(0);
});

test("URL directe : le membre du Cabinet ouvre le courrier du Service Technique → refusé", async ({ page }) => {
  await loginAs(page, fx.users.membreAlpha, fx.password);
  await page.goto(`/courrier/${fx.alpha.techCourierId}`);
  await page.waitForLoadState("networkidle");
  await expect(page.getByText(TECH)).toHaveCount(0, { timeout: 15_000 });
});

test("Storage : le membre du Cabinet lit la pièce d'un courrier hors de son organisation → refusé", async () => {
  const membre = await userClient(fx.users.membreAlpha, fx.password);
  const dl = await membre.storage.from("clara-documents").download(fx.alpha.rootDocument.storageKey);
  expect(dl.error).not.toBeNull();
});
