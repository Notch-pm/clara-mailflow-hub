# Routes

> Dernière vérification : 2026-09-13, alignée sur `src/App.tsx`.

Définies dans `src/App.tsx`. Trois zones : publique, super-admin, utilisateur authentifié.
Toute nouvelle route doit être ajoutée ici dans la même PR que son ajout dans `App.tsx`.

## Public / anonyme

| Path | Page | Wrapper | Note |
|---|---|---|---|
| `/connexion` | `Login` | `PublicRoute` | Redirige vers `/` ou `/superadmin` si déjà connecté. |
| `/reset-password` | `ResetPassword` | Aucun | Accessible depuis le lien de réinitialisation. |
| `/activer-compte` | `ActivateAccount` | Aucun | Lien d'invitation / activation. |
| `/accessibilite` | `Accessibility` | Aucun | Déclaration d'accessibilité. |
| `/portail/:token` | `PortalFormPage` | Aucun | Formulaire portail public, sécurisé par token applicatif. |

## Super-admin (`SuperAdminRoute` — requiert `users.is_superadmin = true`)

| Path | Page |
|---|---|
| `/superadmin` | `SuperAdminDashboard` |
| `/superadmin/organisations` | `OrganizationsAdmin` |
| `/superadmin/organisations/:orgId` | `OrgSettings` |

## Utilisateur (`ProtectedRoutes` + `AppLayout` — requiert session + appartenance org)

| Path | Page | Description |
|---|---|---|
| `/` | `Dashboard` | Vue d'ensemble. |
| `/boite-aux-lettres` | `BoiteAuxLettres` | Tri des courriers reçus : liste à gauche, panneau du courrier sélectionné à droite (`MailboxSidePanel`). |
| `/courriers-en-instruction` | `CourriersEnInstruction` | États `in_progress`. |
| `/courriers-traites` | `CourriersTraites` | États `processed`. |
| `/courriers-archives` | `CourriersArchives` | États `archived`. |
| `/courriers-sortants` | `CourriersSortants` | Réponses + courriers outbound. |
| `/courrier/:id` | `CourierDetail` → `CourierWorkspacePage` | Écran d'instruction : en-tête d'identité, onglets (détail, contenu/IA, actions liées, réponses, participants, liens, historique) et colonne latérale (expéditeur, classement, avancement workflow). |
| `/workflows/:id` | `WorkflowDetail` | Éditeur React Flow lazy-loaded. |
| `/parametres` | `SettingsPage` | Hub vers les paramètres de l'organisation active. |
| `/mon-profil` | `MonProfil` | Profil utilisateur. |
| `/contacts` | `Contacts` | Annuaire des contacts (référentiel Socle via contacts-api). |
| `/contacts/:id` | `Contacts` | Fiche contact (données Socle + courriers liés + demandes Iris de l'usager). |
| `/demandes/:irisRequestId` | `DemandeDetail` | Une demande instruite dans Iris, en lecture seule : texte, statut, réponse apportée, puis demandes d'intervention, commentaires internes et activité (`iris-request-detail`). Ouverte depuis la carte « Demandes » de la fiche contact. 404 hors des organisations de l'utilisateur. |
| `/recherche` | `RechercheCourrierPage` | Recherche transverse des courriers. |
| `/import-en-masse` | `BulkImport` | Assistant d'import de courriers en lot. |
| `/statistiques` | `StatistiquesPage` | Statistiques lazy-loaded. |


## Espace élu (`ProtectedRoutes` + `EluModeGate` + `EluLayout`)

Servi au rôle `elu` **sur téléphone** (moins de 768 px), sauf s'il a demandé l'affichage
complet. `EluModeGate` (`src/components/elu/EluModeGate.tsx`) arbitre : il renvoie `/` vers
`/elu` quand les trois conditions tiennent, et ramène `/elu/*` vers `/` dès que l'une tombe
— changement de rôle, écran élargi, affichage complet demandé. Les autres rôles ne voient
jamais ces routes. Réglage retenu par appareil : `clara.elu-affichage:<userId>` en
`localStorage` (`src/lib/elu-mode.ts`).

Un lien profond vers un écran classique (`/courrier/:id` depuis une notification) reste servi
par `AppLayout`, qui pose alors un retour « ‹ Espace élu » (`EluReturnBanner`).

| Path | Page | Description |
|---|---|---|
| `/elu` | `EluAccueil` | Ce qui attend l'élu : courriers à signer, compteurs du mois, accès à la recherche. |
| `/elu/a-signer` | `EluASigner` | File des réponses en attente de sa signature, avec leur ancienneté. Visible même s'il n'est pas signataire (état vide). |
| `/elu/reponse/:replyId` | `EluReponse` | Lecture d'une réponse et actions du workflow (signer, transitions secondaires). |
| `/elu/courrier/:courierId` | `EluCourrier` | Le courrier reçu, en lecture seule : expéditeur, résumé de l'analyse, intentions, pièces jointes ; en bas, réponses apportées, commentaires internes et activité (mêmes libellés que l'onglet Historique, `src/lib/courier-history.ts`). Atteint depuis la file à signer, le détail d'une réponse et la recherche. |
| `/elu/recherche` | `EluRecherche` | Derniers courriers reçus tant que rien n'est saisi, puis recherche courriers + usagers (`useGlobalSearch`, partagée avec la recherche globale). |
| `/elu/usager/:contactId` | `EluUsager` | Fiche d'un usager : coordonnées cliquables, ses courriers et ses demandes Iris. |
| `/elu/demande/:irisRequestId` | `EluDemande` | Une demande Iris vue par l'élu : ce que demande l'usager, statut, réponse apportée, puis interventions, commentaires internes et activité. |
| `/elu/indicateurs` | `EluIndicateurs` | Enveloppe qui monte **la page de statistiques existante** — jamais dupliquée ; elle lui pose seulement la gouttière que `main` lui donne ailleurs. Masquée si `canAccessStats` est faux. |

## Sous-pages paramètres

`SettingsPage` et `OrgSettings` ne déclarent pas de sous-routes React Router : ce sont des sections internes pilotées par état local. Les cartes visibles dépendent de l'écran :

### `SettingsPage` (`/parametres`)

- **Organisations** — `SocleOrganizationTree`, hiérarchie Socle, workflows, boîtes IMAP, membres et signataires par organisation.
- **Utilisateurs** — `UsersPage`, gestion des membres et rôles.
- **Signatures et tampons** — `SignaturesSettings`.
- **Emails (IMAP)** — `ImapSettings`, réception automatique.
- **Workflows** — `Workflows`.
- **Démarches** — `ProceduresSettings`, démarches synchronisées depuis le Socle.
- **Classification** — `ClassificationSettings`, tags de classement.
- **Modèles de documents** — `ModeleSettings`.
- **Portail citoyen** — `PortalFormsSettings`.
- **Consommation IA** — `AiUsageSettings`, lecture seule côté org.

### `OrgSettings` (`/superadmin/organisations/:orgId`)

- **Organisations** — `SocleOrganizationTree` avec override superadmin.
- **Utilisateurs** — `UsersPage` pour l'organisation ciblée.
- **Emails (réception IMAP)** — `ImapSettings`. Le **serveur d'envoi (SMTP) ne se saisit plus dans Clara** depuis le 2026-08-23 : il vient du référentiel (organisation racine) et arrive par la synchronisation ; l'écran de saisie et le bouton de test ont été supprimés.
- **Intégrations** — `OrgIntegrations`.
- **Démarches** — `SocleIntegrationSettings` + `ProceduresSettings`.
- **Classification** — `ClassificationSettings`.
- **Consommation IA** — `AiUsageSettings` éditable.

## Fallbacks

- Aucune session → redirect `/connexion`.
- Session OK mais pas de profile → `NoProfileFallback` (signOut auto).
- Profile OK mais pas d'appartenance org → `NoOrganizationFallback`.
- Superadmin sur zone utilisateur → redirect `/superadmin`.
- Route inconnue → `NotFound`.
