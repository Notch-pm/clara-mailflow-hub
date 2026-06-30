# Matrice des droits d'accès

## Niveaux de droits

| Niveau | Source | Portée |
|---|---|---|
| **Anonyme** | Pas de session | Pages publiques uniquement |
| **Superadmin** | `users.is_superadmin = true` | Global, toutes organisations |
| **Administrateur d'organisation** | `organization_users.role = 'administrateur'` | Une organisation, accès complet + paramètres |
| **Élu / Superviseur** | `role = 'elu' \| 'superviseur'` | Une organisation, accès complet **hors** paramètres |
| **Gestionnaire** | `role = 'gestionnaire'` | Une organisation, sans paramètres ni statistiques |
| **Consultant** | `role = 'consultant'` | Une organisation, accès standard hors paramètres |

> Un superadmin est redirigé d'office vers `/superadmin` et n'utilise pas les écrans utilisateur standards.

---

## Pages publiques (aucune authentification)

| Route | Écran | Notes |
|---|---|---|
| `/connexion` | Login | — |
| `/reset-password` | Réinitialisation mot de passe | Via lien email |
| `/activer-compte` | Activation de compte | Via lien d'invitation |
| `/accessibilite` | Déclaration RGAA | — |
| `/portail/:token` | Formulaire portail public | Token unique par formulaire |

---

## Superadmin uniquement

| Route | Écran | Action |
|---|---|---|
| `/superadmin` | Dashboard superadmin | Vue globale |
| `/superadmin/organisations` | Liste des organisations | Créer / désactiver une org |
| `/superadmin/organisations/:orgId` | Paramètres d'une organisation | Édition complète d'une org tierce |

**Actions exclusives** : créer une organisation, basculer `is_superadmin`, voir les données cross-org, configurer les intégrations globales.

---

## Tout utilisateur authentifié d'une organisation (member + admin)

| Route | Écran | Notes |
|---|---|---|
| `/` | Tableau de bord | Vue d'ensemble + courriers en attente de signature |
| `/boite-aux-lettres` | Boîte aux lettres | Nouveaux courriers reçus |
| `/courriers-en-instruction` | En instruction | États `in_progress` |
| `/courriers-traites` | Traités | États `processed` |
| `/courriers-archives` | Archivés | États `archived` |
| `/courriers-sortants` | Sortants | Réponses + courriers outbound |
| `/courrier/:id` | Détail courrier | Contenu, IA, historique, notes, liens, réponses |
| `/usagers`, `/usagers/:id` | Annuaire usagers | Consultation + édition |
| `/recherche` | Recherche transverse | — |
| `/statistiques` | Statistiques | Lecture seule |
| `/import-en-masse` | Import en masse | Création de courriers en lot |
| `/mon-profil` | Profil personnel | Avatar, signature, mot de passe |
| `/parametres` | Hub paramètres | Sous-pages selon rôle |

**Actions courrier** (tous membres) :
- Créer un courrier, lancer l'OCR + analyse IA.
- Ajouter notes, mentionner un utilisateur (`@`).
- Lier des courriers entre eux, fermer en cascade.
- Créer un ticket d'action.
- Rédiger une réponse, appliquer un modèle.
- Transitions de workflow disponibles selon l'état courant.
- Uploader des pièces jointes.

---

## Admin d'organisation uniquement

Accessibles depuis `/parametres` :

| Sous-page | Périmètre |
|---|---|
| **Configuration générale** | Nom, logo, durées de conservation courriers / usagers |
| **Utilisateurs** (`UsersPage`) | Inviter, désactiver, changer rôle, marquer signataire |
| **Services** (`ServicesSettings`) | Créer/éditer services internes + IMAP par service |
| **Classification / Workflows** | Workflows, états, transitions, catégories, tags |
| **Modèles de réponse** | CRUD modèles |
| **Signataires** | CRUD signataires + upload image signature |
| **Démarches** (`ProceduresSettings`) | CRUD + synchronisation Arpège |
| **Quartiers** | Référentiel géographique |
| **SMTP / IMAP organisation** | Configuration email |
| **Intégrations** (`OrgIntegrations`) | Arpège (URL, client_id, secret) |
| **Formulaires portail** | Création / diffusion de formulaires publics |
| **Liens utiles** | Configuration de la sidebar liens externes |

**Actions exclusives admin** :
- Signature électronique (si l'utilisateur est marqué `is_signataire`).
- Gestion des membres et de leurs rôles.
- Configuration des durées de conservation déclenchant la purge nocturne (`pg_cron`).

---

## Garde-fous techniques

- **RLS Postgres** sur toutes les tables métier : un membre ne voit que son `organization_id` via le helper `is_member_of`.
- **Trigger `prevent_superadmin_escalation`** : un utilisateur ne peut pas se promouvoir superadmin.
- **Policy `users_update_own`** : `WITH CHECK (id = auth.uid() AND is_superadmin = false)`.
- **Edge functions** : vérification JWT + `is_admin_of(org_id)` pour les actions admin (invite, sync Arpège, reset password).
- **Bucket `clara-documents`** : chemin préfixé par `organization_id`, RLS via `is_member_of`.
- **Bucket `user-avatars`** : public intentionnellement (URL d'avatar directe, pas de données sensibles).
- **Job pg_cron de purge** : exécuté en `service_role`, indépendant des sessions utilisateur.

---

## Checklist avant d'ajouter une nouvelle page

- [ ] Définir le niveau requis (anonyme / membre / admin / superadmin).
- [ ] Placer la route sous le bon wrapper dans `src/App.tsx` (`PublicRoute`, `ProtectedRoutes`, `SuperAdminRoute`).
- [ ] Si action admin : vérifier `membership.role === 'admin'` côté UI **et** via RLS / edge function côté serveur.
- [ ] Si nouvelle table : RLS activée, policies scoppées par `organization_id`, grants explicites.
- [ ] Documenter la route dans `docs/routes.md` et mettre à jour ce fichier.
