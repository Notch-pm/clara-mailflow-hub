import { expect, type Page } from "@playwright/test";
import type { TestMailbox } from "../support/mailbox";
import { toastLocator } from "../helpers";

/** Paramètres → Emails (IMAP) : ajout d'une boîte et relève manuelle, comme un administrateur. */
export async function openImapSettings(page: Page) {
  await page.goto("/parametres");
  await page.getByText("Emails (IMAP)", { exact: true }).first().click();
  await expect(page.getByText("Réception d'emails (IMAP)")).toBeVisible({ timeout: 15_000 });
}

export interface ImapBoxForm {
  label: string;
  box: TestMailbox;
  /** Nom de l'organisation cible ; absent = « — Aucune — ». */
  orgName?: string;
  scanSenders?: string[];
}

export async function addImapBox(page: Page, f: ImapBoxForm) {
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: /Nouvelle configuration IMAP/ });
  await expect(dialog).toBeVisible();
  await dialog.locator("#imap-label").fill(f.label);
  if (f.orgName) {
    await dialog.getByRole("combobox").first().click();
    await page.getByRole("option", { name: f.orgName }).first().click();
  }
  if (f.scanSenders) {
    await dialog.getByRole("switch").first().click();
    await dialog.getByPlaceholder(/copieur-accueil/).fill(f.scanSenders.join(", "));
  }
  await dialog.getByRole("tab", { name: "Connexion" }).click();
  await dialog.locator("#imap-host").fill(f.box.imap.host);
  await dialog.locator("#imap-port").fill(String(f.box.imap.port));
  await dialog.locator("#imap-username").fill(f.box.user);
  await dialog.locator("#imap-password").fill(f.box.pass);
  await dialog.getByRole("button", { name: /Enregistrer|Ajouter|Créer/ }).last().click();
  await expect(toastLocator(page, "Configuration IMAP enregistrée")).toBeVisible({ timeout: 15_000 });
}

/** Clique « Tester » puis « Récupérer » sur la ligne de la boîte ; rend le nombre importé. */
export async function testAndFetch(page: Page, label: string): Promise<number> {
  const row = page.locator("div.rounded-lg.border").filter({ hasText: label }).first();
  await row.getByRole("button", { name: "Tester" }).click();
  await expect(toastLocator(page, /Connexion IMAP réussie/)).toBeVisible({ timeout: 45_000 });
  await row.getByRole("button", { name: "Récupérer" }).click();
  const done = toastLocator(page, /Récupération terminée/);
  // Une relève qui rejette tout n'affiche pas ce toast : la ligne porte alors « Dernière récupération » + le motif.
  await expect(done.or(row.getByText(/Dernière récupération/)).first()).toBeVisible({ timeout: 120_000 });
  const m = (await done.innerText({ timeout: 2_000 }).catch(() => "")).match(/(\d+) email/);
  return m ? Number(m[1]) : 0;
}
