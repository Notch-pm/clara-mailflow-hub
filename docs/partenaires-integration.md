# Spec — Intégration Partenaires (Arpège pilote)

> **Iris n'est pas un partenaire tiers** : c'est un autre produit de la gamme, propriétaire
> exclusif des demandes d'usagers. Son connecteur (2026-08-23) réutilise néanmoins ce modèle —
> `organization_integrations` par tenant, verrou superadmin, sémantique de suspension du §5 —
> et est documenté à part : `docs/iris-integration.md`.

> **Statut : spécifié le 2026-07-23 ; lots L0–L2 livrés (PR #13, migrations + edge en prod) ; L3–L7 à venir.**
> Cadré via `/spec` (analyse métier + architecture) sur inventaire complet code + base live.
> Décisions PO actées le 2026-07-23 (Laurent) : granularité **par organisation Socle**,
> le **suivi des demandes existantes continue pendant la suspension**, implémentation L0→L2 d'abord.

## 1. Besoin (PO)

1. Intégrer des partenaires (Arpège en premier) depuis l'**espace superadmin uniquement** :
   sélection du partenaire, saisie des éléments de connexion API, **suspension** de l'interface.
   **Depuis le 2026-10-02, cette saisie se fait dans le Socle** (fiche du client, section
   « Intégrations », super admin seul) ; Clara n'en tient qu'un miroir en lecture seule (§3bis).
2. Dans le produit, si l'interface est **active** : récupérer les démarches du partenaire (edge),
   **activer/désactiver les démarches par organisation**, créer des demandes chez le partenaire.

Contexte : la chaîne a fonctionné puis a été mise de côté (démarches basculées sur le Socle,
cron décommissionné). Le flux tickets (`create-arpege-demande` / `check-arpege-ticket-status`)
est resté vivant de bout en bout ; la config (`OrgIntegrations`) est déjà de facto superadmin-only
côté UI, mais **pas côté RLS** (voir §3).

## 2. Modèle en deux étages

- **Catalogue global de partenaires** (métadonnées : « Arpège existe, voici ses champs ») —
  choisi par le superadmin. Support : table `integration_providers` (lot L3, différable —
  une constante code suffit tant qu'il n'y a qu'Arpège).
- **Instance de connexion par tenant** (`organization_integrations`) : identifiants Hawk de
  l'Espace Citoyens **de la collectivité** (`api_base_url`, `client_id`, `client_secret`,
  `api_url_ticketingapp` opt., `access_token` legacy), `is_active`.
  `organization_id NOT NULL` + `UNIQUE(organization_id, provider)`.

## 3. Sécurité — constat critique et verrou

La RLS actuelle (`org_admin_manage_integrations`, `is_admin_of`, ALL) permet à un **admin de
tenant** de lire/écrire la config et ses **secrets** par appel direct — l'UI seule le masque.
Verrou (lot L2) :

- **Écritures ET lecture** de `organization_integrations` → **`is_superadmin` uniquement**
  (+ `service_role_full_access` conservée pour les edge functions).
- **RPC `partner_integration_status(org, provider)`** (SECURITY DEFINER, garde `is_member_of`)
  → `{configured, is_active}` **sans aucun secret** : c'est par elle que le produit sait si
  l'interface est active (grisage, boutons).
- Secrets : restent en clair, **alignés sur la dette P1.1** (chantier Vault global IMAP/SMTP +
  intégrations) ; mais l'UI cesse de re-servir `client_secret` en clair au navigateur.

## 3bis. Configuration servie par le Socle (2026-10-02)

- Le Socle sert la configuration d'une racine par
  `GET /v1/organizations/{racine}/integrations/arpege` (public-api ≥ 1.34.0, scope
  `integrations`, secrets compris, `is_active` effectif). `sync-socle-referentiel` la recopie
  par la RPC de service `sync_arpege_integration_from_socle` (logique pure
  `sync-socle-referentiel/arpege.ts`).
- **Plus aucune écriture cliente** des lignes `provider = 'arpege'`, superadmin compris
  (migration `20261002161635_arpege_fin_transition.sql` : la policy superadmin est scindée,
  ses écritures excluent Arpège ; Iris reste saisi par le superadmin). Seul le service role
  écrit. L'écran `OrgIntegrations` n'affiche plus que le statut, l'URL, le client ID, l'URL
  espace agent, et le bouton « Tester la connexion API » (« Récupérer les démarches » supprimé, §3ter).
- **Fin de la transition** : une réponse 200 sans configuration complète (`configured: false`,
  ou déclaration inexploitable) **suspend** la ligne recopiée (`is_active = false`, RPC de
  service `suspend_arpege_integration_from_socle`, compteur `arpege_suspendu`) **sans effacer
  les identifiants** : le suivi des demandes déjà déposées continue (§5, lot L5). Les réponses
  403, 404 et 5xx laissent la ligne inchangée, avec un avertissement.

## 3ter. Démarches servies par le Socle (2026-10-02)

- Les démarches Arpège vivent dans le Socle (public-api 1.35.0) : importées d'Arpège sur la fiche
  du client (Intégrations → Arpège), activées par organisation dans « Démarches activées ».
  Elles arrivent par la sync habituelle `GET /v1/procedures?enabled_for=` avec
  `partner: {integration: "arpege", reference: <CodeQualificationTypeDemande>, config:
  {CodeQualificationMetier, ConfigInfoUsagerObligs, FormComponents}}` (`config` a la forme de
  `procedures.arpege_config_fields`). `partner: null` = démarche Socle (Iris). Le Socle ne les
  sert qu'à la clé de Clara, jamais à Iris ni au portail.
- La sync écrit `external_reference_id` / `arpege_config_fields` (`external_source` reste
  `'socle'`) ; `partner: null` les **efface** ; `partner` absent (Socle < 1.35) les laisse
  intacts. Les 36 anciennes démarches locales `external_source='arpege'` d'ACCM (retirées, 13
  tickets y pointent) ne sont plus adoptées par nom. Effet : 3 démarches Socle d'ACCM qui
  avaient hérité d'une référence Arpège par adoption de nom (D_RDV_SCOL, MARIAGE2, NAISSANCE2)
  routent désormais vers Iris.
- `create-arpege-demande` applique l'activation par organisation (409 si non activée) et pose
  `action_tickets.socle_organization_id` ; `push-iris-request` ne dépose jamais une démarche
  Arpège (`skipped`, `reason: "partenaire"`). Ceci réalise l'enforcement visé au §6 et le
  dédoublonnage du §7 (une seule ligne par démarche, plus de récupération côté Clara) ; le
  grisage du dialogue (interface suspendue) est fait, le badge sur les demandes existantes non (L7).

## 4. Matrice des droits

| Action | superadmin | administrateur | éditeurs (gest./élu/superv.) | consultant |
|---|:---:|:---:|:---:|:---:|
| Configurer / éditer la connexion | ✅ **dans le Socle** (lecture seule dans Clara) | ❌ | ❌ | ❌ |
| Suspendre / réactiver | ✅ **dans le Socle** | ❌ | ❌ | ❌ |
| Tester la connexion | ✅ | ❌ | ❌ | ❌ |
| Récupérer / rafraîchir les démarches | ✅ **dans le Socle** (import) | ❌ | ❌ | ❌ |
| Activer/désactiver une démarche **par organisation Socle** | ✅ | ✅ | ❌ | ❌ |
| Créer une demande chez le partenaire | ✅ | ✅ | ✅ | ❌ |
| Voir demandes + statut (à jour) | ✅ | ✅ | ✅ | ✅ |

Le rafraîchissement de statut est une **réconciliation système** (écriture service_role
idempotente, non attribuable à l'utilisateur) : le consultant voit un statut à jour sans
déclencher d'écriture qui lui soit imputable (résout l'asymétrie d'auth actuelle de
`check-arpege-ticket-status`, membership-only).

## 5. Sémantique de la suspension (`is_active = false`)

| Effet | Décision |
|---|---|
| Création de nouvelles demandes | **Bloquée** (edge, appel direct compris) |
| Récupération des démarches | **Bloquée** |
| Démarches partenaire dans le sélecteur | **Grisées / non sélectionnables** (info-bulle « Interface suspendue ») |
| Suivi de statut des demandes **déjà émises** | **Continue** (décision PO) — la suspension coupe le nouveau trafic, pas le suivi ; une clôture/refus côté Arpège n'est jamais perdue |
| Demandes existantes | Restent visibles, badge « Interface suspendue », dernier statut connu |

## 6. Activation des démarches par organisation (lot L6)

- Nouvelle table `socle_org_procedure_activations(id, organization_id, socle_organization_id,
  procedure_id, is_active, …)`, `UNIQUE(socle_organization_id, procedure_id)`.
  RLS : SELECT `is_member_of`, écritures `is_admin_of`, `service_role_full`.
- **Sémantique opt-out** : absence de lignes pour une organisation = toutes les démarches
  `is_displayed` restent autorisées (ne bloque pas le tenant pilote).
- **Enforcement serveur** dans `create-arpege-demande` : lit `couriers.socle_organization_id`,
  refuse si la démarche n'est pas activée pour cette organisation (AC-SRV-9).
- `is_displayed` (tenant-wide) reste la visibilité globale — les deux se composent.
- UI : toggle par organisation dans `ProceduresSettings` (admin tenant) ; filtre/grisage dans
  `CreateTicketDialog` selon interface active + activation pour l'organisation du courrier.

## 7. Dédoublonnage Socle/Arpège (lot L4)

- **Obsolète depuis le 2026-10-02** (`sync-arpege-services` supprimée, démarches servies par le
  Socle : §3ter). Historique : clé d'identité `external_reference_id`. Le matching de
  `sync-arpege-services` (filtré `external_source='arpege'`) créait des doublons quand le Socle a adopté la démarche —
  cause probable des 39 lignes résiduelles à `arpege_config_fields`.
- Règle : si une `procedure` du tenant porte le même `external_reference_id` (quel que soit
  `external_source`), **mise à jour de `arpege_config_fields` uniquement** — jamais de 2ᵉ ligne,
  jamais d'écrasement du descriptif Socle (nom, description, formulaire). Sinon INSERT
  `external_source='arpege'`.
- Fusion des doublons existants : conditionnelle, avec snapshot (attention
  `action_tickets.procedure_id ON DELETE RESTRICT`).

## 8. Plan en lots (chacun rollback-able)

| Lot | Contenu | Dépend de |
|---|---|---|
| **L0** | Décommissionnement : suppression `sync-arpege-appointments` (morte), `DROP FUNCTION trigger_arpege_sync()` (orpheline), docs (2 edge non documentées, `features.md` §Arpège périmée, `permissions.md` Intégrations) | — |
| **L1** | Hawk mutualisé dans `_shared/arpege.ts` (copié-collé ×5 aujourd'hui), refactor iso-comportement des 4 edges vivantes ; UI `OrgIntegrations` réalignée (requis = `api_base_url`+`client_id`+`client_secret` ; `access_token` legacy), activation gated par test réussi, secret non re-servi | — |
| **L2** | Verrou RLS superadmin-only + `UNIQUE(organization_id, provider)` + `NOT NULL` + RPC `partner_integration_status` ; tests d'intégration AC-SRV-1/2/3 | — |
| **L3** | ~~Catalogue `integration_providers`~~ — **remplacé le 2026-10-02 par le catalogue du Socle** (« Intégrations », fiche client du super admin) : la configuration Arpège se saisit dans le Socle et Clara la recopie (`sync-socle-referentiel`, scope `integrations`). Transition retirée le même jour (§3bis) : plus de saisie dans Clara, et un Socle sans configuration complète **suspend** la ligne recopiée, identifiants conservés | — |
| **L4** | Dédoublonnage (matching `external_reference_id`) + fusion conditionnelle | L1 souple |
| **L5** | Réconciliation privilégiée du statut + suivi maintenu en suspension (retrait du gate `is_active` en lecture des identifiants pour `check-arpege-ticket-status`) | L1 |
| **L6** | Table d'activations + toggle UI + enforcement serveur (ordre interne strict : table → repli opt-out → UI → enforcement) | L2 souple |
| **L7** | Finitions UI suspension (grisage, badges) via le RPC | L2, L5 |

Décisions par défaut actées : pas de renommage `arpege-*` ; pas de cron Arpège ; pas
d'abstraction multi-provider au-delà du catalogue ; `organization_id NOT NULL` (0 ligne NULL
vérifiée en base).

## 9. Critères d'acceptation (extraits — détail dans l'historique de spec)

**Serveur** (harnais `src/test-integration/*.itest.ts`) : AC-SRV-1 admin tenant ne peut pas
écrire `organization_integrations` ; AC-SRV-2 superadmin peut (Iris — **plus Arpège**, AC-SRV-4/4bis/4ter :
ni création, ni modification, ni suppression, ni renommage de provider vers Arpège) ; AC-SRV-3 aucune fuite
cross-tenant de secrets ; AC-SRV-4 consultant 403 sur création (non-régression) ; AC-SRV-5
suspension bloque création+sync en appel direct ; AC-SRV-6 le suivi des demandes existantes
continue en suspension ; AC-SRV-7 rafraîchissement non attribuable au consultant ; AC-SRV-8
pas de doublon Socle/Arpège sur `external_reference_id` ; AC-SRV-9 création refusée si démarche
non activée pour l'organisation du courrier.

**UI** : config atteignable superadmin seulement ; activation après test réussi ; boutons cachés
si suspendu ; démarches grisées (suspension ou non-activation) ; demandes existantes visibles
avec dernier statut ; consultant read-only ; toggle par organisation dans les paramètres Démarches.

## 10. Hors périmètre

RDV partenaire (`sync-arpege-appointments` décommissionnée) ; 2ᵉ partenaire concret ;
cron Arpège ; filtre de lecture intra-tenant (RLS SELECT `is_member_of`, pré-existant) ;
refonte des formulaires demandeur/métier de `CreateTicketDialog`.
