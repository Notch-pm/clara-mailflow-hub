# Matrice des droits d'accès

> Dernière vérification : 2026-09-13.
>
> **État au 2026-07-22.** La lecture seule du `consultant` est **appliquée côté serveur**
> (RLS `is_editor_of` en base + garde `assertEditor` dans les edge functions) **et côté UI**.
> Reste **hors périmètre** (voir « État d'application ») : le filtre intra-tenant par
> organisation Socle demeure **UI-only** — un membre peut lire tout le tenant via appel direct.

## Niveaux de droits

| Niveau | Source | Portée |
|---|---|---|
| **Anonyme** | Pas de session | Pages publiques uniquement |
| **Superadmin** | `users.is_superadmin = true` | Global, toutes organisations |
| **Administrateur d'organisation** | `organization_users.role = 'administrateur'` | Une organisation, accès complet + paramètres |
| **Gestionnaire / Élu / Superviseur** | `role IN ('gestionnaire','elu','superviseur')` | Une organisation : traitement des courriers, **hors** paramètres. Droits identiques entre eux pour l'instant (différenciation élu/superviseur à venir). |
| **Consultant** | `role = 'consultant'` | Une organisation : **consultation seule** — aucune écriture sur les courriers. |

> Un superadmin est redirigé d'office vers `/superadmin` et n'utilise pas les écrans utilisateur standards.

### Droits par rôle d'organisation (cible)

| Action | administrateur | gestionnaire | elu | superviseur | consultant |
|---|:---:|:---:|:---:|:---:|:---:|
| Voir les courriers (scopés à ses organisations Socle + non-assignés) | ✅ ¹ | ✅ | ✅ | ✅ | ✅ |
| Créer / modifier / traiter un courrier (workflow, tags, notes, participants, liens, tickets) | ✅ | ✅ | ✅ | ✅ | ❌ |
| Rédiger / envoyer une réponse | ✅ | ✅ | ✅ | ✅ | ❌ |
| Accéder aux Statistiques | ✅ | ❌ ² | ✅ | ✅ | ✅ |
| Paramètres / configuration / gestion des utilisateurs | ✅ | ❌ | ❌ | ❌ | ❌ |

1. L'administrateur voit **tout le tenant** (pas de restriction par organisation Socle).
2. Le gestionnaire est **volontairement** exclu des statistiques (`canAccessStats`, `src/lib/permissions.ts`) — décision produit assumée au 2026-07-22 (comportement conservé tel quel).

➕ **Attribut transverse — Signataire** (`is_signataire`) : **indépendant du rôle**. Seul un utilisateur marqué signataire peut **signer** une réponse ; l'attribut se cumule avec n'importe quel rôle et n'est pas un profil à part entière.

➕ **Attribut transverse — Gestionnaire courrier** (`organization_users.is_service_courrier`, 2026-10-01) : **indépendant du rôle**, comme le signataire. Donne accès à l'écran **« Courrier entrant »** (`/courrier-entrant`), où le service courrier qualifie, route, suit et relance les courriers reçus. Il n'ouvre **aucun droit d'écriture** : c'est toujours `canEditCouriers` / `is_editor_of` qui décide (un consultant marqué gestionnaire courrier voit l'écran sans pouvoir router). Prédicats : `isServiceCourrier`, `canAccessMailroom` (profil, administrateur ou superadmin), `showsMailbox` (un gestionnaire courrier non administrateur ne voit plus la boîte aux lettres dans la navigation) — `src/lib/permissions.ts`. Coché par un administrateur dans la fiche utilisateur.

➕ **Espace élu sur téléphone** (2026-09-13) : le rôle `elu` reçoit une interface dédiée et simplifiée quand il ouvre Clara sur un écran de moins de 768 px — voir `docs/routes.md` § « Espace élu ». **Ce n'est pas un niveau de droits** : l'élu garde exactement les mêmes autorisations qu'un gestionnaire (`canEditCouriers`), seuls les écrans changent. Le mode se coupe par appareil (« Affichage complet », menu de l'avatar ou `Mon profil`). Prédicat : `isElu()` dans `src/lib/permissions.ts` ; arbitrage : `src/lib/elu-mode.ts`. Depuis le 2026-09-23, la fiche usager et le courrier y montrent aussi les demandes Iris de l'usager, les réponses, les **commentaires internes** et l'activité — mêmes droits que tout membre, périmètre des demandes appliqué côté serveur (voir plus bas).

### État d'application

**Consultant en lecture seule — APPLIQUÉ (2026-07-22).** Trois niveaux d'autorisation intra-tenant coexistent désormais :

- `is_member_of` (tout membre actif) → **lecture** (SELECT) des données opérationnelles ;
- `is_editor_of` (membre actif dont le rôle ≠ `consultant`, superadmin inclus) → **écriture** (INSERT/UPDATE/DELETE) sur `couriers`, `courier_events`, `courier_notes`, `courier_participants`, `courier_links`, `courier_relations`, `action_tickets`, `courier_documents`, `courier_analyses`, `courier_document_extracts`, `courier_sequences`, `notifications`, `roles`, + le bucket Storage `clara-documents` + le RPC `enqueue_courier_analysis` ;
- `is_admin_of` (administrateur) → **configuration**.

Défense en profondeur côté edge (fonctions en `service_role`, hors RLS) : garde `assertEditor` (`supabase/functions/_shared/authz.ts`) sur `send-courier-reply`, `create-arpege-demande`, `push-iris-request` (déposer une demande dans Iris, ou la renvoyer, est un effet de bord — le consultant est refusé ; la **réconciliation** nocturne, elle, est une écriture système non attribuable, donc un consultant voit un statut à jour sans rien déclencher), `send-mention-notification`, `draft-reply`, `extract-courier-info`, `analyze-courier` (branche utilisateur uniquement — le worker cron reste sur `x-cron-secret`), `storage-documents` (upload/delete), `socle-contacts` (mutations). Migration : `supabase/migrations/20260722194100_consultant_read_only_is_editor_of.sql`.

**Demandes Iris d'un usager — périmètre appliqué côté serveur (2026-09-23).** La fonction
`iris-contact-requests` (fiche contact, espace élu) ne rend, hors administrateur et
superadmin, que les demandes des organisations Socle de l'appelant et celles sans organisme.
Contrairement aux courriers, ce filtre n'est **pas** UI-only : ce sont les données d'Iris.

**Hors périmètre (inchangé) — filtre intra-tenant par organisation Socle** : toujours appliqué **UI-only** (`useUserServiceFilter`) ; la RLS SELECT reste `is_member_of` (visibilité à l'échelle du tenant). Un membre — consultant compris — peut donc *lire* tout le tenant via appel direct. Risque pré-existant, à traiter dans un ticket dédié.

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

**Actions exclusives** : créer une organisation, basculer `is_superadmin`, voir les données cross-org, **configurer les intégrations partenaires** (`OrgIntegrations` — connexion Arpège, suspension : monté uniquement sur `/superadmin/organisations/:orgId` ; écritures et lecture de `organization_integrations` verrouillées `is_superadmin` côté RLS, cf. `docs/partenaires-integration.md`).

---

## Tout utilisateur authentifié d'une organisation (member + admin)

| Route | Écran | Notes |
|---|---|---|
| `/` | Tableau de bord | Vue d'ensemble + courriers en attente de signature |
| `/boite-aux-lettres` | Boîte aux lettres | Nouveaux courriers reçus. Masquée dans la navigation d'un gestionnaire courrier non administrateur |
| `/corbeille` | Corbeille et spam | **Mêmes que Courrier entrant** (`canAccessMailroom`, miroir SQL `can_access_mailroom`) ; restaurer / supprimer définitivement / vider exigent en plus `canEditCouriers` (`is_editor_of`). Barre mobile : gestionnaire courrier seulement |
| `/courrier-entrant` | Courrier entrant | **Gestionnaire courrier, administrateur, superadmin** (`canAccessMailroom`) — sinon redirection vers la boîte aux lettres |
| `/courriers-en-instruction` | En instruction | États `in_progress` |
| `/courriers-traites` | Traités | États `processed` |
| `/courriers-archives` | Archivés | États `archived` |
| `/courriers-sortants` | Sortants | Réponses + courriers outbound |
| `/courrier/:id` | Détail courrier | Contenu, IA, historique, notes, liens, réponses |
| `/contacts`, `/contacts/:id` | Annuaire des contacts (référentiel Socle) | Consultation + édition via contacts-api |
| `/recherche` | Recherche transverse | — |
| `/statistiques` | Statistiques | Lecture seule |
| `/import-en-masse` | Import en masse | Création de courriers en lot |
| `/mon-profil` | Profil personnel | Avatar, signature, mot de passe |
| `/parametres` | Hub paramètres | Sous-pages selon rôle |

**Actions courrier** (rôles avec droit d'écriture : administrateur, gestionnaire, élu, superviseur — **pas** le consultant, cf. matrice « Droits par rôle ») :
- Créer un courrier, lancer l'OCR + analyse IA.
- Ajouter notes, mentionner un utilisateur (`@`).
- Lier des courriers entre eux, fermer en cascade.
- Créer une demande liée au courrier (démarche Iris ou partenaire).
- Rédiger une réponse, appliquer un modèle.
- Transitions de workflow disponibles selon l'état courant.
- Uploader des pièces jointes.

---

## Admin d'organisation uniquement

Accessibles depuis `/parametres` :

| Sous-page | Périmètre |
|---|---|
| **Configuration générale** | Nom, logo, durée de conservation des courriers |
| **Utilisateurs** (`UsersPage`) | Inviter, désactiver, changer rôle, marquer signataire |
| **Organisations** (`SocleOrganizationTree`) | Configurer hiérarchie Socle, membres, signataires, workflows et boîtes IMAP par organisation |
| **Classification / Workflows** | Workflows, états, transitions, catégories, tags |
| **Modèles de réponse** | CRUD modèles |
| **Signataires** | CRUD signataires + upload image signature |
| **Démarches** (`ProceduresSettings`) | CRUD + synchronisation Arpège |
| **Emails (IMAP)** | Boîtes de réception, globales ou par organisation Socle. Le **serveur d'envoi (SMTP) n'est plus paramétrable dans Clara** : il vient du référentiel et arrive par la synchronisation (miroir en lecture service uniquement) |
| **Formulaires portail** | Création / diffusion de formulaires publics |

**Actions exclusives admin** :
- Signature électronique (si l'utilisateur est marqué `is_signataire`).
- Gestion des membres et de leurs rôles.
- Configuration des durées de conservation déclenchant la purge nocturne (`pg_cron`).

---

## Garde-fous techniques

- **RLS Postgres** sur toutes les tables métier : un membre ne voit que son `organization_id` via le helper `is_member_of`.
- **Garde de signature serveur** (trigger `couriers_enforce_signature`, `20260723163536`) : poser ou retirer les marqueurs de signature d'une réponse (`metadata.signed_at/signed_by/signed_state_id`) exige que l'acteur soit **lié comme signataire de l'organisation gestionnaire** (`signatories.user_id` × `socle_organization_signatories`) — même par appel API direct. La sélection du signataire et l'édition du brouillon restent libres pour tout éditeur ; `is_signataire` demeure l'attribut de configuration en amont.
- **Garde de transitions serveur** (trigger `couriers_enforce_transition`, `20260723101849`) : un changement d'état de workflow doit être topologiquement légal (transition configurée, reset à l'initial, clôture) — cf. `docs/garde-transitions-workflow.md`.
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
- [ ] Si action admin : vérifier `membership.role === 'admin' || membership.role === 'administrateur'` côté UI **et** via RLS / edge function côté serveur.
- [ ] Si nouvelle table : RLS activée, policies scoppées par `organization_id`, grants explicites.
- [ ] Documenter la route dans `docs/routes.md` et mettre à jour ce fichier.
