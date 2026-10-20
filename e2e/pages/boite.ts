import { expect, type Page } from "@playwright/test";

/** Gestes de l'écran « À instruire » et du dialogue « Nouveau courrier ». */
export class Boite {
  constructor(readonly page: Page) {}

  async open() {
    await this.page.goto("/a-instruire");
    await expect(this.page.getByRole("button", { name: /Ajouter du courrier/ })).toBeVisible({ timeout: 20_000 });
  }

  /** Ouvre le dialogue de saisie (étape 1 : import de fichiers / texte). */
  async openNewCourier() {
    await this.page.getByRole("button", { name: /Ajouter du courrier/ }).click();
    await this.page.getByRole("menuitem", { name: /Saisir un courrier/ }).click();
    await expect(this.page.getByRole("dialog", { name: /Nouveau courrier/ })).toBeVisible();
  }
}
