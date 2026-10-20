import { test } from "../support/fixtures";

// ═══ Actions « Demande » : dépôt Iris (démarche du référentiel) et envoi Arpège.
// BLOQUÉS : dépendances externes à fournir (voir le rapport). Ils figurent au
// rapport en « fixme » avec la raison exacte.

test.fixme("dépôt Iris : une action fondée sur une démarche du référentiel crée la demande dans Iris, son statut remonte dans l'onglet Actions liées — BLOQUÉ : (1) aucune démarche synchronisée dans les tenants [TEST] (la table `procedures` est vide au seed, sync Socle nocturne) ; (2) une demande déposée dans Iris est IRRÉVERSIBLE (trigger d'immuabilité) : il faut un tenant/une démarche Iris DÉDIÉS aux tests et marqués (source « clara », démarche « [TEST] E2E »), fournis par Iris", async () => {
  // Parcours cible : /courrier/:id (En instruction) → Actions liées → Créer → Demande →
  // démarche « [TEST] E2E » → destinataire usager (contact Socle de test) → Créer →
  // le ticket affiche l'identifiant Iris, puis /demandes/:irisRequestId s'ouvre en lecture seule.
});

test.fixme("envoi Arpège : une action fondée sur une démarche Arpège crée la demande chez le partenaire — BLOQUÉ : pas de sandbox Arpège ni de connexion de test (configurée dans le Socle, fiche client › Intégrations) ; à fournir par Notch/Arpège", async () => {
  // Parcours cible : même écran, démarche Arpège → formulaire ArpegeForms → Créer → statut « transmis ».
});

test.fixme("consultant : tentative de dépôt Iris par appel direct à push-iris-request refusée — à écrire en intégration (assertEditor) dès qu'une démarche de test existe", async () => {});
