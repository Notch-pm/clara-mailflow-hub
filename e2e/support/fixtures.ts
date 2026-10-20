import { test as base, expect } from "@playwright/test";
import { hasServiceRole, loadMailboxes, type MailBoxes } from "./admin";

export { expect };

/**
 * `test` de la suite. Deux gardes de prérequis, qui rendent l'absence d'une
 * dépendance externe VISIBLE (test sauté avec sa raison) au lieu d'un rouge :
 *  - `needAdmin()` : SUPABASE_SERVICE_ROLE_KEY (préparation / vérification) ;
 *  - `needMail()`  : boîtes de test Ethereal + relais SMTP posés par globalSetup.
 */
export const test = base.extend<{
  needAdmin: () => void;
  needMail: () => MailBoxes;
}>({
  needAdmin: async ({}, use, testInfo) => {
    await use(() => {
      testInfo.skip(!hasServiceRole, "SUPABASE_SERVICE_ROLE_KEY absent (préparation de données impossible)");
    });
  },
  needMail: async ({}, use, testInfo) => {
    await use(() => {
      testInfo.skip(!hasServiceRole, "SUPABASE_SERVICE_ROLE_KEY absent");
      const boxes = loadMailboxes();
      testInfo.skip(!boxes, "Boîtes mail de test indisponibles (Ethereal injoignable ?)");
      return boxes!;
    });
  },
});

/** Marque un scénario comme bloqué par une dépendance externe : visible « fixme » dans le rapport. */
export function blocked(title: string, reason: string, spec: () => void = () => undefined) {
  test.fixme(`${title} — BLOQUÉ : ${reason}`, async () => {
    spec();
  });
}
