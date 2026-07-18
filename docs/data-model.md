# Modèle de données

> Schéma extrait du remote Supabase le 2026-05-22. Source de vérité pour les requêtes et migrations.

## Principes

- **PostgreSQL** managé par Supabase. Types générés dans `src/integrations/supabase/types.ts` (ne **jamais** éditer à la main).
- **Multi-tenant strict** : toutes les tables métier ont `organization_id uuid NOT NULL REFERENCES organizations(id)`.
- **RLS activée partout** via `is_member_of` / `is_admin_of` / `is_superadmin`. Voir `docs/database-rls.md`.
- **Extensions** : `postgis` (schéma `public`) — activée historiquement pour les quartiers (fonctionnalité retirée le 2026-07-16, portage prévu côté Socle) ; l'extension reste installée mais plus aucune table ne l'utilise.

## Pattern RLS

```sql
-- Tables standard (membres) :
USING     (public.is_member_of(organization_id))
WITH CHECK (public.is_member_of(organization_id))

-- Tables admin (services, workflows, procedures, tags…) :
USING     (public.is_admin_of(organization_id))
WITH CHECK (public.is_admin_of(organization_id))
```

Le header `x-org-id` n'est **plus** utilisé dans les policies — il est uniquement injecté par le client Supabase (`src/integrations/supabase/client.ts`) pour que certaines fonctions edge puissent l'utiliser.

---

## Enums

| Enum | Valeurs |
|---|---|
| `courier_direction` | `inbound` `outbound` `internal` |
| `courier_channel` | `email` `paper` `portal` |
| `workflow_category` | `pending` `processing` `processed` `archived` |
| `document_type` | (USER-DEFINED, voir types.ts) |
| `participant_role` | (USER-DEFINED, voir types.ts) |
| `sync_status` | `pending` + autres (voir types.ts) |
| `workflow_type` | (USER-DEFINED, voir types.ts) |

---

## Tables

### Identité & tenants

#### `organizations`
Tenants racine. RLS sur `id` (pas sur `organization_id`).

| Colonne | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `name` | varchar NOT NULL | |
| `slug` | varchar UNIQUE | lowercase, contrainte CHECK |
| `metadata` | jsonb | `{}` par défaut |
| `status` | varchar | `'active'` par défaut |
| `logo_url` | text | |
| `primary_color` / `secondary_color` | text | |
| `multiple_imap` | boolean | multi-boîtes IMAP |
| `reply_template_html` / `_design` / `_data` / `_storage_key` | text/jsonb | template courrier Unlayer |
| `address_*` / `phone` / `website` / `contact_email` | text | coordonnées org |
| `socle_org_id` | uuid | mapping vers l'org Socle (renseigné par le superadmin) ; NULL = pas de sync Socle |

#### `users`
Profils étendus (miroir `auth.users`). Trigger `prevent_superadmin_escalation` bloque l'auto-promotion.

| Colonne | Type | Notes |
|---|---|---|
| `id` | uuid PK | = `auth.users.id` |
| `email` | varchar UNIQUE NOT NULL | |
| `first_name` / `last_name` | varchar | |
| `avatar_url` | text | |
| `is_active` | boolean | |
| `is_superadmin` | boolean NOT NULL DEFAULT false | modifiable uniquement par superadmin |

#### `organization_users`
Appartenance d'un user à une org. Source unique des permissions d'org.

| Colonne | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `organization_id` | uuid FK → organizations | |
| `user_id` | uuid FK → users | |
| `role` | varchar | `'admin'` \| `'administrateur'` \| `'member'` |
| `is_active` | boolean | |
| `is_signataire` | boolean | |
| `signataire_title` | text | |

---

### Courriers (cœur métier)

#### `couriers`
Table centrale. Tags stockés dans `metadata->'tags'` (tableau JSON de strings).

| Colonne | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `organization_id` | uuid FK | |
| `chrono` | varchar | numéro séquentiel annuel |
| `direction` | enum `courier_direction` | `inbound` \| `outbound` \| `internal` |
| `channel` | enum `courier_channel` | `email` \| `paper` \| `portal` |
| `subject` | text | |
| `workflow_state_id` | uuid FK → workflow_states | |
| `received_at` | timestamp | date réception (inbound) |
| `sent_at` | timestamp | date envoi (outbound) |
| `parent_courier_id` | uuid FK → couriers | réponse à un courrier |
| `assigned_service` | varchar | nom de l'organisation gestionnaire — **pure dénormalisation d'affichage** (toujours écrite en double, mais plus aucune logique ne compare ce texte) |
| `socle_organization_id` | uuid FK → socle_organizations | organisation gestionnaire — **clé de toute la logique** : RPC `stats_*` (`p_socle_organization_id`), `search_couriers`, filtres de droits (`useUserServiceFilter` → UUIDs via `socle_organization_members`), résolutions dans le panneau courrier/composer |
| `metadata` | jsonb | `tags: string[]`, `body_text`, etc. — voir clés d'ingestion ci-dessous |
| `fts_subject` / `fts_body` | tsvector | index full-text français |

Clés `metadata` posées par l'ingestion IMAP (`fetch-inbound-emails`) :

| Clé | Notes |
|---|---|
| `email_message_id` | clé de déduplication des imports |
| `email_from` / `email_to` / `body_text` / `body_html` | bruts du message (les deux corps sont `null` en mode scan) |
| `source` | `'imap'` \| `'scan'` \| `'portal'` |
| `imap_settings_id` | boîte d'origine |
| `email_size_bytes` | taille du message |
| `is_large_email` | `true` au-delà de 2 Mo. **Exposé en colonne par le RPC `search_couriers`** et affiché en icône dans la Boîte aux lettres — les listes ne rapatrient pas le jsonb. |
| `scan_device_email` | mode scan : adresse du copieur, jamais confondue avec l'expéditeur |
| `needs_qualification` | mode scan : courrier à qualifier par un agent |
| `ignored_attachments` | pièces jointes écartées (hors gabarit) |

#### `courier_participants`
Expéditeurs, destinataires, copies d'un courrier.

| Colonne | Type | Notes |
|---|---|---|
| `role` | enum `participant_role` | |
| `name` / `first_name` / `last_name` | varchar | données **du courrier** (From: brut du mail, saisie portail/agent) — pas le référentiel |
| `email` / `phone` / `address` | text | idem |
| `organization` | varchar | |
| `socle_contact_id` | uuid | référence optionnelle vers un **contact du Socle** (référentiel externe, pas de FK) — l'identité de référence se lit via `contacts-api` (proxy `socle-contacts`) |
| `fts_participant` | tsvector | full-text sur name + email |

> `courier_participants` est la **table de liaison** courrier ↔ contacts Socle : N participants par courrier, chacun typé par `role` et liable individuellement à un contact. Dissocier = `socle_contact_id = NULL` (la fiche Socle n'est jamais supprimée par Clara).

#### `courier_documents`
Pièces jointes (stockées dans le bucket `clara-documents`).

| Colonne | Type | Notes |
|---|---|---|
| `storage_key` | text NOT NULL | chemin dans le bucket |
| `document_type` | enum | |
| `file_name` / `mime_type` | varchar | |
| `file_size` | integer | bytes |
| `checksum` | varchar | |

#### `courier_document_extracts`
Résultats OCR d'un document.

| Colonne | Type |
|---|---|
| `document_id` | uuid UNIQUE FK → courier_documents |
| `text` | text |
| `page_count` / `tokens_used` | integer |
| `model` | text |
| `fts_extract` | tsvector |

#### `courier_analyses`
Analyse LLM par courrier (cache).

| Colonne | Type |
|---|---|
| `courier_id` | uuid UNIQUE FK → couriers |
| `summary` | text |
| `intents` | jsonb array |
| `sentiment` | text |
| `suggested_actions` | jsonb array |
| `model` / `tokens_used` | text / integer |

#### `courier_analysis_jobs`
File d'attente de l'analyse (OCR + LLM), consommée par l'edge function `process-analysis-queue` (cron 2 min).

**Pourquoi une file.** Les chemins d'**ingestion** — réception IMAP, import en masse — ne peuvent pas océriser en ligne : c'est long, coûteux en quota IA, et une erreur ferait perdre tout un lot. Sans elle, seuls les courriers créés à la main via `NewCourierDialog` avaient des extraits. La numérisation rend le manque bloquant : personne n'est devant l'écran pour cliquer « Analyser ».

| Colonne | Type | Notes |
|---|---|---|
| `organization_id` | uuid FK | |
| `courier_id` | uuid FK → couriers | |
| `kind` | text | `ocr` \| `analyze` \| `full` |
| `status` | text | `pending` \| `running` \| `done` \| `failed` |
| `attempts` | integer | abandon à 3 |
| `last_error` | text | `'quota_exceeded'`, `'worker timeout'`, … |
| `requested_by` | uuid FK → users | `NULL` pour un job produit par un ingesteur serveur |
| `scheduled_at` | timestamptz | réessai différé |
| `started_at` / `finished_at` | timestamptz | |

Deux garde-fous à ne pas retirer :
- **Index UNIQUE partiel** sur `courier_id WHERE status IN ('pending','running')` : réimporter ou recliquer « Analyser » n'empile pas d'OCR concurrents sur les mêmes documents (double facturation IA et écritures concurrentes sur `courier_document_extracts`).
- **Quota IA épuisé** → job reporté au mois suivant **sans consommer de tentative**. Sans ce rollback, trois passages de cron condamneraient un courrier parfaitement analysable le mois suivant.

RLS : lecture seule pour les membres du tenant. Aucune écriture cliente — l'enfilement passe par le RPC `enqueue_courier_analysis` (SECURITY DEFINER, re-vérifie l'appartenance), la consommation par `claim_analysis_jobs` / `requeue_stale_analysis_jobs`, réservés au `service_role`.

#### `courier_events`
Journal d'audit immuable.

| Colonne | Type | Notes |
|---|---|---|
| `event_type` | varchar | ex. `'state_changed'`, `'email_received'`, `'scan_received'` — **varchar libre, pas un enum** : ajouter un type ne demande aucune migration |
| `payload` | jsonb | ex. `{ "from_id": "...", "to_id": "..." }` pour state_changed |
| `created_by` | uuid FK → users | |

Pour calculer les délais de traitement : `event_type = 'state_changed'`, puis `payload->>'to_id'` → join `workflow_states.category`.

#### `courier_notes`
Notes internes libres sur un courrier.

#### `courier_links`
Relations entre courriers et systèmes externes (`external_type`, `external_id`, `sync_status`).

#### `courier_sequences`
Compteurs annuels par direction pour la numérotation `chrono`.

| Colonne | Type |
|---|---|
| `year` | integer |
| `direction` | enum `courier_direction` |
| `last_value` | integer |

---

### Workflows

#### `workflows`

| Colonne | Type | Notes |
|---|---|---|
| `name` | varchar | |
| `type` | enum `workflow_type` | principal vs réponse |
| `is_default` | boolean | |

#### `workflow_states`

| Colonne | Type | Notes |
|---|---|---|
| `workflow_id` | uuid FK | |
| `name` | varchar | |
| `category` | enum | `pending` \| `processing` \| `processed` \| `archived` |
| `is_initial` / `is_final` | boolean | |
| `requires_signature` / `is_send` | boolean | |

#### `workflow_transitions`
`from_state_id` → `to_state_id` avec `name` et `condition jsonb`.

---

### Référentiels d'organisation

#### `services`
Services internes (ex. "Urbanisme", "État civil").

| Colonne | Type | Notes |
|---|---|---|
| `name` | varchar | aussi stocké comme TEXT dans `couriers.assigned_service` |
| `email` | varchar | |
| `workflow_id` | uuid FK → workflows | workflow principal |
| `reply_workflow_id` | uuid FK → workflows | workflow réponse |
| `imap_settings_id` | uuid FK → imap_settings | boîte IMAP dédiée |
| `address_*` / `phone` / `website` / `contact_email` | text | |

#### `service_members`
Membres d'un service (`organization_id`, `service_id`, `user_id`).

#### `service_signatories`
Signataires assignés à un service (`service_id` → `signatories.id`).

#### `signatories`
Personnes autorisées à signer. Image de signature dans le bucket `signatures`.

| Colonne | Type |
|---|---|
| `user_id` | uuid FK → users (optionnel) |
| `first_name` / `last_name` | varchar |
| `title` | text |
| `signature_storage_key` | text |

#### `procedures`
Démarches administratives. **Source de vérité : le Socle** (référentiel central), synchronisé chaque nuit par l'edge function `sync-socle-referentiel`. Plus de création/suppression côté Clara (policies RLS `admin_insert`/`admin_delete` supprimées) ; seul le toggle `is_displayed` reste éditable par les admins (`admin_update` conservé).

| Colonne | Type | Notes |
|---|---|---|
| `name` | varchar | |
| `external_reference_id` / `external_source` | varchar | `'socle'` (sync) ou `'arpege'` (legacy) ; les refs Arpège sont conservées après adoption |
| `is_displayed` | boolean | masquage local (seul champ éditable côté Clara) |
| `display_order` | integer | ← `order_index` Socle |
| `arpege_config_fields` | jsonb | config formulaire Arpège (conservée pour `create-arpege-demande`) |
| `socle_id` | uuid | UUID Socle — clé d'idempotence, index unique partiel `(organization_id, socle_id)` |
| `type` | varchar | `interne` \| `externe` |
| `keywords` | jsonb | tableau de mots-clés |
| `user_description` / `agent_description` | text | descriptions Socle (`short_description` → `description`) |
| `input_duration_minutes` | integer | |
| `socle_category_id` | uuid | UUID Socle de la catégorie (jointure logique via `socle_categories.socle_id`, sans FK) |
| `requester_config` / `form_schema` / `knowledge_base` / `translations` | jsonb | blocs Socle stockés tels quels (UUID internes préservés) |
| `synced_at` | timestamptz | dernière sync |
| `obsoleted_at` | timestamptz | soft-delete : disparue du Socle ou embryon remplacé (jamais de DELETE — `action_tickets.procedure_id` est `ON DELETE RESTRICT`) |

#### `socle_categories` / `socle_document_types`
Miroirs du référentiel Socle, dupliqués par org Clara (`UNIQUE (organization_id, socle_id)`). Lecture seule côté client (pas de policy d'écriture utilisateur, seule l'edge function écrit via service_role). Colonnes : `socle_id`, `name`, `icon` (catégories uniquement), `synced_at`, `obsoleted_at`.

#### `socle_organizations`
Miroir de la **hiérarchie d'organisations** du Socle (sous-arbre du `socle_org_id` mappé, racine incluse — son `socle_parent_id` est neutralisé à NULL). `UNIQUE (organization_id, socle_id)`. **Les organisations sont les unités de traitement de Clara** (elles remplacent les services) : les champs Socle sont réécrasés par la sync nocturne, les champs de config Clara sont éditables par les admins (`admin_update`).

| Colonne | Type | Notes |
|---|---|---|
| `socle_id` / `socle_parent_id` | uuid | hiérarchie — parenté logique socle→socle, sans FK |
| `name` / `slug` / `type` | varchar | champs Socle |
| `status` | varchar | statut Socle `active` \| `obsolete` (distinct de `obsoleted_at` = disparue du périmètre) |
| `phone` / `email` / `address` / `logo_url` | text | coordonnées Socle affichées dans l'arbre |
| `workflow_id` | uuid FK → workflows | **config Clara** : workflow des courriers reçus |
| `reply_workflow_id` | uuid FK → workflows | **config Clara** : workflow des réponses |
| `synced_at` / `obsoleted_at` | timestamptz | |

La boîte IMAP d'une org est rattachée via `imap_settings.socle_organization_id`. Arbre + panneau de config : `src/components/SocleOrganizationTree.tsx` + `OrganizationConfigDialog.tsx` (sections « Organisations » de SettingsPage et OrgSettings) ; le nœud **racine** porte l'UI des paramètres globaux du tenant (fichier domiciliaire, « Différencier les adresses mail de réception par organisation » = `organizations.multiple_imap`, rétention/purge — stockage inchangé sur `organizations`). Service client : `src/services/socleOrgConfigService.ts`.

#### `socle_organization_members` / `socle_organization_signatories`
Membres et signataires d'une organisation (remplacent `service_members`/`service_signatories`). `UNIQUE (socle_organization_id, user_id|signatory_id)`, RLS select `is_member_of` / écriture `is_admin_of`. Les membres pilotent le filtrage des courriers (`useUserServiceFilter` — liste d'**UUIDs** d'orgs) ; les signataires alimentent le composer de réponse.

#### `services` / `service_members` / `service_signatories` — **GELÉES**
Remplacées par les organisations Socle (données migrées le 2026-07-11, conservées pour historique/rollback). Plus aucun flux d'écriture ; `fetch-inbound-emails` et `portal-form` gardent un fallback legacy en lecture.

#### `socle_sync_runs`
Journal des synchronisations Socle : une ligne par org et par run (`started_at`, `finished_at`, `status` running/success/error, `dry_run`, `counters` jsonb, `error`).

#### `courier_tags`
Dictionnaire de tags (étiquettes) de l'org. Les tags appliqués sont dans `couriers.metadata->'tags'` (array de noms).

| Colonne | Type |
|---|---|
| `name` | varchar |
| `color` | varchar |

#### `roles`
Rôles personnalisés d'une organisation (usage libre, pas de lien direct RLS).

#### Contacts (référentiel Socle — plus de table locale)

Depuis le 2026-07-16, **le Socle est la source de vérité des contacts/usagers** : les
tables `usagers` et `quartiers` (et leurs RPC, enums, colonnes `organizations.domiciliary_file_enabled`
/ `usager_retention_days`) ont été supprimées (migration `20260716200000_socle_contacts_referentiel.sql`).

- Clara ne stocke que la **référence** `courier_participants.socle_contact_id` (uuid Socle, sans FK).
- Lecture/écriture des fiches : edge function **`socle-contacts`** (proxy vers `contacts-api`
  du Socle) — point de passage unique. Liaison par la **clé plateforme unique** `SOCLE_API_KEY`
  (scopes read+contacts, non liée à une organisation côté Socle) : le proxy transmet le tenant
  visé via l'en-tête `X-Organization-Id`, le référentiel servi étant celui de sa **racine**.
- Service client unique : `src/services/socleContactService.ts`. Page annuaire : `/contacts`.
- Le référentiel vit au niveau de l'**org racine** Socle : les tenants Clara mappés sous la
  même racine (ex. ACCM et Marie d'Arles) partagent le même référentiel de contacts.
- **Relations entre contacts** (2026-07-16) : table Socle `contact_relations`
  (« <contact> est <rôle> de <contact> », rôle du catalogue `contact_roles`) exposée dans
  la fiche `Contact` (`relations` sortantes éditables en replace-set, `reverse_relations`
  entrantes en lecture) ; affichées dans Clara sur la fiche contact, les participants
  d'un courrier et l'expéditeur du panneau courrier.
- Suppression côté Socle : `contacts-api` n'expose qu'archive/restore ; un contact
  disparu (hard delete SQL) rend un 404 que l'UI gère (proposition de dissociation).
- **Quartiers** : la fonctionnalité a quitté Clara le 2026-07-16 et vit désormais **côté
  Socle** (table `quartiers` PostGIS, découpage par racine, import GeoJSON). Clara la
  **consomme en lecture seule** depuis le 2026-07-18 : la fiche contact porte un objet
  `quartier` (`id`, `name`, `color`) déjà **résolu** par `contacts-api` — pas d'UUID à
  traduire, pas d'appel supplémentaire (`GET /v1/quartiers` du référentiel ne sert qu'au
  catalogue et aux géométries, hors de proportion pour un libellé). Affiché par
  `src/components/contacts/QuartierBadge.tsx` sur la fiche `/contacts`, les participants
  d'un courrier et l'expéditeur du panneau courrier ; colonne « Quartier » à l'export CSV.
  Le rattachement lui-même (géocodage BAN de l'adresse puis point-dans-polygone) est
  **entièrement calculé par le Socle** — Clara ne saisit ni ne modifie ce champ.
  ⚠️ Le champ est **optionnel** dans `SocleContact` : une fiche servie par une version de
  `contacts-api` antérieure au 2026-07-18 ne le porte pas.

---

### Configuration email

#### `smtp_settings`
Un enregistrement par org (`organization_id UNIQUE`). Envoi de notifications et réponses.

#### `imap_settings`
Plusieurs par org si `organizations.multiple_imap = true`. Réception automatique.

| Colonne | Type | Notes |
|---|---|---|
| `host` / `port` / `username` / `password` | text/int | |
| `use_tls` | boolean | |
| `folder` | text | `'INBOX'` par défaut |
| `auto_fetch` | boolean | |
| `label` | text | `'Principal'` par défaut |
| `socle_organization_id` | uuid FK → socle_organizations | org propriétaire de la boîte — reportée sur les courriers entrants |
| `last_fetch_at` / `last_error` | timestamptz/text | |
| `is_scan_inbox` | boolean, défaut `false` | **Boîte de numérisation** : boîte alimentée par un copieur réseau, pas par des correspondants. Bascule l'ingestion en mode scan (voir ci-dessous). |
| `scan_allowed_senders` | text[] | Adresses des copieurs autorisés à déposer. `NULL` = aucune restriction — **à éviter** : quiconque connaît l'adresse pourrait créer des courriers dans le tenant. |
| `max_email_bytes` | integer | Plafond par email pour cette boîte. `NULL` = plafond global de l'edge function (15 Mo). |

**Mode boîte de numérisation** (`is_scan_inbox = true`), appliqué par `fetch-inbound-emails` :
`channel = 'paper'` (l'email n'est qu'un transport), **aucun participant `sender`** (le copieur n'est pas l'expéditeur — son adresse va dans `metadata.scan_device_email`), sujet remplacé par « Courrier numérisé — à qualifier » (le sujet MFP est du bruit), corps non indexé, et un `courier_analysis_jobs` enfilé dès qu'une pièce jointe est stockée.

---

### Intégrations & notifications

#### `organization_integrations`
Connexions OAuth/API tierces (Arpège…).

| Colonne | Type |
|---|---|
| `provider` | text |
| `client_id` / `client_secret` / `access_token` | text |
| `api_base_url` / `api_url_ticketingapp` | text |
| `is_active` | boolean |

#### `action_tickets`
Tâches dérivées d'un courrier, liées ou non à une procédure (action libre).

| Colonne | Type | Notes |
|---|---|---|
| `courier_id` | uuid FK | immuable (trigger) |
| `procedure_id` | uuid FK → procedures | nullable : action libre sans démarche |
| `title` | text | titre de l'action — exigé côté formulaire quand `procedure_id` est null |
| `assignee_id` | uuid FK → users | nullable en DB (tickets Arpège) ; exigé côté formulaire pour les tickets Clara |
| `status` | text | `'open'` par défaut |
| `arpege_demande_ref` / `arpege_demande_status` | text | |

#### `notifications`
Notifications in-app. RLS scoped `user_id = auth.uid()`.

| Colonne | Type |
|---|---|
| `user_id` | uuid FK → users |
| `type` | text (`'new_courier'` par défaut) |
| `resource_id` | uuid |
| `read` | boolean |

---

## Storage buckets

| Bucket | Public | RLS |
|---|---|---|
| `clara-documents` | Non | `is_member_of(storage.foldername(name)[1])` |
| `signatures` | Non | `is_member_of(storage.foldername(name)[1])` |
| `user-avatars` | **Oui** | public intentionnel |

---

## Conventions pour nouvelles tables

1. `organization_id uuid NOT NULL REFERENCES organizations(id)`
2. RLS activée automatiquement (event trigger `rls_auto_enable`)
3. Policies via `is_member_of` ou `is_admin_of` — jamais de `EXISTS` inline
4. `service_role_full` ALL true pour les edge functions
5. Index sur `(organization_id, ...)` pour les requêtes fréquentes
6. `created_at` / `updated_at` + trigger `set_updated_at`
7. Migration versionnée `supabase/migrations/<timestamp>_<slug>.sql`
