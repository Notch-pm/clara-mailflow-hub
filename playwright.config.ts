import { defineConfig, devices } from "@playwright/test";

// E2E des parcours critiques Clara, contre le serveur Vite local et le projet
// Supabase de test (tenants [TEST] — lancer `bun run seed:test` avant la suite).
//
// Mode visible : `bun run test:e2e:headed` (navigateur affiché, ralenti par
// E2E_SLOWMO, 300 ms par défaut dans ce mode). Exemple :
//   E2E_SLOWMO=600 bun run test:e2e:headed -- e2e/reponse
const headed = process.argv.includes("--headed");
const slowMo = Number(process.env.E2E_SLOWMO ?? (headed ? 300 : 0));

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts/,
  globalSetup: "./e2e/global-setup.ts",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false, // données partagées entre specs (fixtures seedées)
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:8080",
    trace: "retain-on-failure",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "fr-FR",
    launchOptions: { slowMo: Number.isFinite(slowMo) ? slowMo : 0 },
  },
  webServer: {
    command: "bun run dev",
    url: "http://localhost:8080",
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
