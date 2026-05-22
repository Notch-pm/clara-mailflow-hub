# Modèle de données

> Schéma extrait du remote Supabase le 2026-05-22. Source de vérité pour les requêtes et migrations.

## Principes

- **PostgreSQL** managé par Supabase. Types générés dans `src/integrations/supabase/types.ts` (ne **jamais** éditer à la main).
- **Multi-tenant strict** : toutes les tables métier ont `organization_id uuid NOT NULL REFERENCES organizations(id)`.
- **RLS activée partout** via `is_member_of` / `is_admin_of` / `is_superadmin`. Voir `docs/database-rls.md`.

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
| `usager_category` | `citoyen` + autres (voir types.ts) |
| `usager_civilite` | (USER-DEFINED, voir types.ts) |
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
| `assigned_service` | varchar | nom du service (TEXT, pas UUID) |
| `metadata` | jsonb | `tags: string[]`, `body_text`, etc. |
| `fts_subject` / `fts_body` | tsvector | index full-text français |

#### `courier_participants`
Expéditeurs, destinataires, copies d'un courrier.

| Colonne | Type | Notes |
|---|---|---|
| `role` | enum `participant_role` | |
| `name` / `first_name` / `last_name` | varchar | |
| `email` / `phone` / `address` | text | |
| `organization` | varchar | |
| `usager_id` | uuid | lien optionnel vers `usagers` |
| `fts_participant` | tsvector | full-text sur name + email |

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

#### `courier_events`
Journal d'audit immuable.

| Colonne | Type | Notes |
|---|---|---|
| `event_type` | varchar | ex. `'state_changed'` |
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
Démarches administratives. Sync nocturne possible depuis Arpège.

| Colonne | Type | Notes |
|---|---|---|
| `name` | varchar | |
| `external_reference_id` / `external_source` | varchar | référence Arpège |
| `is_displayed` | boolean | |
| `display_order` | integer | |
| `arpege_config_fields` | jsonb | config formulaire Arpège |

#### `courier_tags`
Dictionnaire de tags (étiquettes) de l'org. Les tags appliqués sont dans `couriers.metadata->'tags'` (array de noms).

| Colonne | Type |
|---|---|
| `name` | varchar |
| `color` | varchar |

#### `roles`
Rôles personnalisés d'une organisation (usage libre, pas de lien direct RLS).

#### `usagers`
Annuaire des personnes (citoyens, entreprises…) connues de l'org.

| Colonne | Type |
|---|---|
| `category` | enum `usager_category` (`citoyen` par défaut) |
| `civilite` | enum |
| `first_name` / `last_name` / `email` / `phone` | varchar |

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
| `last_fetch_at` / `last_error` | timestamptz/text | |

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
Tâches dérivées d'un courrier, liées à une procédure.

| Colonne | Type | Notes |
|---|---|---|
| `courier_id` | uuid FK | immuable (trigger) |
| `procedure_id` | uuid FK → procedures | |
| `assignee_id` | uuid FK → users | |
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
