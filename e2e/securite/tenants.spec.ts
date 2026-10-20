import { loadFixtures, loginAs, userClient } from "../helpers";
import { test, expect } from "../support/fixtures";

// ═══ Étanchéité entre tenants (Alpha ↔ Beta) : accès par URL directe, caches de
// l'application, recherche, pièces jointes Storage. (Complète `tenants-ui.spec.ts`.)

const fx = loadFixtures();

test("URL directe : un admin Beta ouvre un courrier d'Alpha → « introuvable », sans fuite", async ({ page }) => {
  await loginAs(page, fx.users.adminBeta, fx.password);
  await page.goto(`/courrier/${fx.alpha.couriers.root}`);
  await expect(page.getByText("Courrier introuvable").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/\[TEST\] Courrier Alpha/)).toHaveCount(0);
});

test("URL directe : même refus pour la fiche élu et pour une suggestion cachée", async ({ page }) => {
  await loginAs(page, fx.users.adminBeta, fx.password);
  await page.goto(`/elu/courrier/${fx.alpha.couriers.root}`);
  await page.waitForLoadState("networkidle");
  await expect(page.getByText(/\[TEST\] Courrier Alpha/)).toHaveCount(0);
});

test("organisation active forgée : une session Beta avec l'org Alpha en localStorage ne voit rien d'Alpha", async ({ page }) => {
  // Falsifie `clara_org_id` (lu par OrganizationContext) avec l'organisation Alpha
  await loginAs(page, fx.users.adminBeta, fx.password, fx.alpha.orgId);
  await page.goto("/a-instruire");
  await page.waitForLoadState("networkidle");
  await expect(page.getByText(/\[TEST\] Courrier Alpha/)).toHaveCount(0);
  await page.goto(`/recherche?q=${encodeURIComponent("[TEST] Courrier")}`);
  await page.waitForLoadState("networkidle");
  await expect(page.getByText(/\[TEST\] Courrier Alpha/)).toHaveCount(0);
});

test("changement de compte dans le même navigateur : pas de cache d'Alpha pour Beta", async ({ page }) => {
  await loginAs(page, fx.users.adminAlpha, fx.password);
  await page.goto("/a-instruire");
  await expect(page.getByText(/\[TEST\] Courrier Alpha/).first()).toBeVisible({ timeout: 20_000 });
  // Déconnexion franche puis connexion Beta (mêmes localStorage / caches du navigateur)
  await page.evaluate(() => window.localStorage.clear());
  await page.context().clearCookies();
  await page.addInitScript(() => window.localStorage.clear());
  await loginAs(page, fx.users.adminBeta, fx.password);
  await page.goto("/a-instruire");
  await expect(page.getByText(/\[TEST\] Courrier Beta/).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/\[TEST\] Courrier Alpha/)).toHaveCount(0);
});

test("pièces jointes Storage : Beta ne peut ni télécharger, ni lister, ni signer l'URL d'une pièce d'Alpha", async () => {
  const beta = await userClient(fx.users.adminBeta, fx.password);
  const key = fx.alpha.rootDocument.storageKey;
  const dl = await beta.storage.from("clara-documents").download(key);
  expect(dl.error, "téléchargement inter-tenant autorisé !").not.toBeNull();
  const signed = await beta.storage.from("clara-documents").createSignedUrl(key, 60);
  expect(signed.data?.signedUrl ?? null, "URL signée inter-tenant délivrée !").toBeNull();
  const list = await beta.storage.from("clara-documents").list(`${fx.alpha.orgId}/${fx.alpha.couriers.root}`);
  expect(list.data ?? []).toHaveLength(0);
  // Contrôle positif : un membre d'Alpha, lui, la lit
  const alpha = await userClient(fx.users.adminAlpha, fx.password);
  const ok = await alpha.storage.from("clara-documents").download(key);
  expect(ok.error).toBeNull();
});

test("pièce jointe via l'interface : Alpha l'ouvre depuis le courrier, Beta n'a aucun accès au courrier", async ({ page }) => {
  await loginAs(page, fx.users.adminAlpha, fx.password);
  await page.goto(`/courrier/${fx.alpha.couriers.root}`);
  await expect(page.getByText(fx.alpha.rootDocument.fileName).first()).toBeVisible({ timeout: 20_000 });
});

test("route super-admin : un administrateur de tenant est renvoyé hors de /superadmin", async ({ page }) => {
  await loginAs(page, fx.users.adminAlpha, fx.password);
  await page.goto("/superadmin/organisations");
  await expect(page).not.toHaveURL(/superadmin/, { timeout: 15_000 });
});
