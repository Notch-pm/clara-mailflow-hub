import { lazy, type ComponentType } from "react";

/**
 * Écran chargé à la demande, qui survit à une mise en ligne.
 *
 * Le fichier d'une route en `lazy()` porte un nom haché (`WorkflowDetail-a1b2.js`)
 * et n'est demandé qu'au premier clic. Un onglet resté ouvert pendant un
 * déploiement garde en mémoire l'ancien nom : le fichier n'existe plus, l'import
 * échoue, et comme l'application n'a AUCUNE frontière d'erreur, c'est tout
 * l'écran qui disparaît — page blanche, sans message. Le cas est invisible en
 * développement, où Vite ne hache rien.
 *
 * On recharge donc la page UNE fois pour repartir sur la version en ligne. Le
 * drapeau vit en `sessionStorage` (donc dans cet onglet, effacé à la fermeture)
 * pour qu'un échec durable — réseau coupé, fichier vraiment absent — remonte
 * l'erreur au lieu de faire boucler le rechargement.
 */
const RETRY_KEY = "clara:lazy-route-reloaded";

function readFlag(): boolean {
  try {
    return sessionStorage.getItem(RETRY_KEY) === "1";
  } catch {
    // Stockage refusé (navigation privée stricte) : pas de rechargement,
    // l'erreur remonte telle quelle.
    return true;
  }
}

function writeFlag(value: "1" | null) {
  try {
    if (value === null) sessionStorage.removeItem(RETRY_KEY);
    else sessionStorage.setItem(RETRY_KEY, value);
  } catch {
    /* ignoré : voir readFlag */
  }
}

export function lazyRoute<T extends ComponentType<never>>(
  load: () => Promise<{ default: T }>,
) {
  return lazy(async () => {
    try {
      const module = await load();
      writeFlag(null);
      return module;
    } catch (error) {
      if (readFlag()) throw error;
      writeFlag("1");
      window.location.reload();
      // La page s'en va : ne jamais résoudre évite de rendre un écran mort
      // pendant le rechargement.
      return new Promise<never>(() => {});
    }
  });
}
