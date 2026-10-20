import { loadFixtures, loginAs } from "../helpers";
import { test, expect } from "../support/fixtures";

// ═══ Matrice des droits par rôle (docs/permissions.md) : pour chaque compte du
// seed, ce que l'interface montre ET ce qu'elle refuse par URL directe.
// Les refus d'écran sont des redirections (jamais une page vide ni une fuite).

const fx = loadFixtures();

interface Profil {
  nom: string;
  email: string;
  /** Voit le bouton « Ajouter du courrier » (droit d'écriture). */
  ecrit: boolean;
  parametres: boolean;
  stats: boolean;
  /** Écran « Courrier entrant » (service courrier : administrateurs et marqués). */
  courrierEntrant: boolean;
  parapheur: boolean;
}

const PROFILS: Profil[] = [
  { nom: "administrateur", email: fx.users.adminAlpha, ecrit: true, parametres: true, stats: true, courrierEntrant: true, parapheur: false },
  { nom: "gestionnaire", email: fx.users.gestionnaireAlpha, ecrit: true, parametres: false, stats: false, courrierEntrant: false, parapheur: false },
  { nom: "élu", email: fx.users.eluAlpha, ecrit: true, parametres: false, stats: true, courrierEntrant: false, parapheur: false },
  { nom: "superviseur", email: fx.users.superviseurAlpha, ecrit: true, parametres: false, stats: true, courrierEntrant: false, parapheur: false },
  { nom: "consultant", email: fx.users.consultantAlpha, ecrit: false, parametres: false, stats: true, courrierEntrant: false, parapheur: false },
  { nom: "viseur (gestionnaire)", email: fx.users.viseurAlpha, ecrit: true, parametres: false, stats: false, courrierEntrant: false, parapheur: true },
  { nom: "signataire (gestionnaire)", email: fx.users.signataireAlpha, ecrit: true, parametres: false, stats: false, courrierEntrant: false, parapheur: true },
];

for (const p of PROFILS) {
  test.describe(`rôle ${p.nom}`, () => {
    test.beforeEach(async ({ page }) => {
      await loginAs(page, p.email, fx.password, fx.alpha.orgId);
    });

    test("création de courrier : bouton " + (p.ecrit ? "présent" : "absent"), async ({ page }) => {
      await page.goto("/a-instruire");
      await page.waitForLoadState("networkidle");
      const bouton = page.getByRole("button", { name: /Ajouter du courrier/ });
      if (p.ecrit) await expect(bouton).toBeVisible({ timeout: 20_000 });
      else {
        await expect(page.getByText(/À instruire/).first()).toBeVisible({ timeout: 20_000 });
        await expect(bouton).toHaveCount(0);
      }
    });

    test(`/parametres : ${p.parametres ? "accessible" : "refusé"}`, async ({ page }) => {
      await page.goto("/parametres");
      if (p.parametres) await expect(page.getByText("Organisations", { exact: true }).first()).toBeVisible({ timeout: 20_000 });
      else await expect(page.getByText("Accès réservé").first()).toBeVisible({ timeout: 20_000 });
    });

    test(`/statistiques : ${p.stats ? "accessible" : "redirigé"}`, async ({ page }) => {
      await page.goto("/statistiques");
      if (p.stats) await expect(page).toHaveURL(/\/statistiques/, { timeout: 15_000 });
      else await expect(page).not.toHaveURL(/\/statistiques/, { timeout: 15_000 });
    });

    test(`/courrier-entrant : ${p.courrierEntrant ? "accessible" : "redirigé vers À instruire"}`, async ({ page }) => {
      await page.goto("/courrier-entrant");
      if (p.courrierEntrant) await expect(page).toHaveURL(/\/courrier-entrant/, { timeout: 15_000 });
      else await expect(page).toHaveURL(/\/a-instruire/, { timeout: 15_000 });
    });

    test(`/parapheur : ${p.parapheur ? "accessible" : "redirigé"}`, async ({ page }) => {
      await page.goto("/parapheur");
      if (p.parapheur) await expect(page.getByRole("heading", { name: "Parapheur" })).toBeVisible({ timeout: 20_000 });
      else await expect(page).not.toHaveURL(/\/parapheur/, { timeout: 15_000 });
    });
  });
}

test("viseur : onglet « À viser » sans « À signer » ; signataire : l'inverse", async ({ page }) => {
  await loginAs(page, fx.users.viseurAlpha, fx.password, fx.alpha.orgId);
  await page.goto("/parapheur");
  await expect(page.getByRole("tab", { name: /À viser/ })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("tab", { name: /À signer/ })).toHaveCount(0);

  await page.context().clearCookies();
  await page.addInitScript(() => window.localStorage.clear());
  await loginAs(page, fx.users.signataireAlpha, fx.password, fx.alpha.orgId);
  await page.goto("/parapheur");
  await expect(page.getByRole("tab", { name: /À signer/ })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("tab", { name: /À viser/ })).toHaveCount(0);
});

test("un membre ne peut pas ouvrir l'éditeur de workflow par URL directe", async ({ page }) => {
  await loginAs(page, fx.users.gestionnaireAlpha, fx.password, fx.alpha.orgId);
  await page.goto(`/workflows/${fx.alpha.workflowId}`);
  await page.waitForLoadState("networkidle");
  // Aucune édition possible : pas de bouton d'enregistrement du workflow
  await expect(page.getByRole("button", { name: /Enregistrer|Ajouter un état/ })).toHaveCount(0);
});

test("consultant : aucun bouton d'écriture sur la fiche d'un courrier (transition, réponse)", async ({ page }) => {
  await loginAs(page, fx.users.consultantAlpha, fx.password, fx.alpha.orgId);
  await page.goto(`/courrier/${fx.alpha.couriers.assigned}`);
  await expect(page.getByText("[TEST] Courrier Alpha assigné cabinet").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Instruire" })).toHaveCount(0);
});

test("élu : mêmes droits d'écriture qu'un gestionnaire (peut instruire)", async ({ page }) => {
  await loginAs(page, fx.users.eluAlpha, fx.password, fx.alpha.orgId);
  await page.goto(`/courrier/${fx.alpha.couriers.assigned}`);
  await expect(page.getByRole("button", { name: "Instruire" })).toBeVisible({ timeout: 20_000 });
});
