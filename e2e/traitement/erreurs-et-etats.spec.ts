import { loadFixtures, loginAs, uniq, toastLocator } from "../helpers";
import { test, expect } from "../support/fixtures";
import { adminClient, insertInboundCourier } from "../support/admin";
import { Boite } from "../pages/boite";
import { courrierTypePdf } from "../support/files";

// ═══ États limites : échec d'API (l'IA du Socle est coupée), recherche vide,
// concurrence entre deux agents sur le même courrier.

const fx = loadFixtures();

test("API en échec : l'analyse de la pièce échoue → message clair, la saisie manuelle reste possible", async ({ page }) => {
  await loginAs(page, fx.users.adminAlpha, fx.password);
  await page.route("**/functions/v1/extract-courier-info", (route) =>
    route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "Guichet IA indisponible (simulé)" }) }),
  );
  const boite = new Boite(page);
  await boite.open();
  await boite.openNewCourier();
  await page.locator('input[type="file"]').setInputFiles({ name: "x.pdf", mimeType: "application/pdf", buffer: courrierTypePdf("panne") });
  await page.getByRole("button", { name: "Continuer" }).click();
  await expect(toastLocator(page, "Analyse impossible")).toBeVisible({ timeout: 20_000 });
  // On n'est pas bloqué : le bouton d'étape reste utilisable et on peut saisir à la main
  await page.getByRole("button", { name: "Saisir manuellement" }).click();
  await expect(page.locator("#nc-subject")).toBeVisible();
});

test("état vide : une recherche sans résultat l'annonce", async ({ page }) => {
  await loginAs(page, fx.users.adminAlpha, fx.password);
  await page.goto(`/recherche?q=${encodeURIComponent("zzz-introuvable-e2e-qwerty")}`);
  await expect(page.getByText(/Aucun courrier ne correspond/)).toBeVisible({ timeout: 20_000 });
});

test("API en échec : la fiche d'un courrier inexistant affiche « introuvable »", async ({ page }) => {
  await loginAs(page, fx.users.adminAlpha, fx.password);
  await page.goto("/courrier/00000000-0000-4000-8000-000000000000");
  await expect(page.getByText("Courrier introuvable").first()).toBeVisible({ timeout: 20_000 });
});

test("concurrence : deux agents instruisent le même courrier — une seule transition, pas d'état incohérent", async ({ browser, needAdmin }) => {
  needAdmin();
  test.fail(true, "DÉFAUT confirmé : un écran périmé rejoue la transition « Reçu → En instruction » — l'état final est juste mais l'historique porte deux fois state_changed / instruction_started (aucune comparaison avec l'état courant à l'écriture).");
  const id = await insertInboundCourier({
    organizationId: fx.alpha.orgId,
    subject: uniq("concurrence"),
    socleOrganizationId: fx.alpha.rootSocleOrgId,
    assignedService: fx.alpha.name,
    workflowStateId: fx.alpha.states.initial,
  });
  const open = async (email: string) => {
    const ctx = await browser.newContext({ locale: "fr-FR", baseURL: "http://localhost:8080" });
    const page = await ctx.newPage();
    await loginAs(page, email, fx.password, fx.alpha.orgId);
    await page.goto(`/courrier/${id}`);
    await expect(page.getByRole("button", { name: "Instruire" })).toBeVisible({ timeout: 20_000 });
    return { ctx, page };
  };
  const a = await open(fx.users.adminAlpha);
  const b = await open(fx.users.gestionnaireAlpha);
  await a.page.getByRole("button", { name: "Instruire" }).click();
  await expect(a.page.getByText("En instruction").first()).toBeVisible({ timeout: 20_000 });
  // B agit sur un écran périmé (il voit encore « Instruire »)
  await b.page.getByRole("button", { name: "Instruire" }).click();
  await b.page.waitForTimeout(3_000);
  // Quoi qu'il arrive à B (refus ou idempotence), le courrier est « En instruction » et jamais au-delà
  const { data } = await adminClient().from("couriers").select("workflow_state_id").eq("id", id).single();
  expect((data as { workflow_state_id: string }).workflow_state_id).toBe(fx.alpha.states.processing);
  // …et l'historique ne porte pas deux transitions identiques
  const { data: events } = await adminClient().from("courier_events").select("event_type").eq("courier_id", id);
  const transitions = (events ?? []).filter((e) => /state|transition|workflow/i.test((e as { event_type: string }).event_type));
  expect(transitions.length).toBeLessThanOrEqual(1);
  await a.ctx.close();
  await b.ctx.close();
});
