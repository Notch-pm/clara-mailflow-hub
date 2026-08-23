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

## 4. Matrice des droits

| Action | superadmin | administrateur | éditeurs (gest./élu/superv.) | consultant |
|---|:---:|:---:|:---:|:---:|
| Configurer / éditer la connexion | ✅ | ❌ | ❌ | ❌ |
| Suspendre / réactiver / tester | ✅ | ❌ | ❌ | ❌ |
| Récupérer / rafraîchir les démarches | ✅ | ✅ (si active) | ❌ | ❌ |
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

- Clé d'identité : `external_reference_id`. Le matching actuel de `sync-arpege-services`
  (filtré `external_source='arpege'`) crée des doublons quand le Socle a adopté la démarche —
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
| **L3** | Catalogue `integration_providers` + surface superadmin « sélection partenaire » (mince, différable) | — |
| **L4** | Dédoublonnage (matching `external_reference_id`) + fusion conditionnelle | L1 souple |
| **L5** | Réconciliation privilégiée du statut + suivi maintenu en suspension (retrait du gate `is_active` en lecture des identifiants pour `check-arpege-ticket-status`) | L1 |
| **L6** | Table d'activations + toggle UI + enforcement serveur (ordre interne strict : table → repli opt-out → UI → enforcement) | L2 souple |
| **L7** | Finitions UI suspension (grisage, badges) via le RPC | L2, L5 |

Décisions par défaut actées : pas de renommage `arpege-*` ; pas de cron Arpège ; pas
d'abstraction multi-provider au-delà du catalogue ; `organization_id NOT NULL` (0 ligne NULL
vérifiée en base).

## 9. Critères d'acceptation (extraits — détail dans l'historique de spec)

**Serveur** (harnais `src/test-integration/*.itest.ts`) : AC-SRV-1 admin tenant ne peut pas
écrire `organization_integrations` ; AC-SRV-2 superadmin peut ; AC-SRV-3 aucune fuite
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
