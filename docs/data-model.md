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
| `logo_url` / `primary_color` / `secondary_color` | text | **Charte graphique — MIROIR du Socle depuis le 2026-09-13, aucune saisie dans Clara.** Couleurs en `#rrggbb` minuscule (CHECK `organizations_branding_colors_hex`). Voir ci-dessous. |
| `multiple_imap` | boolean | multi-boîtes IMAP |
| `reply_template_html` / `_design` / `_data` / `_storage_key` | text/jsonb | template courrier Unlayer |
| `address_*` / `phone` / `website` / `contact_email` | text | coordonnées org |
| `socle_org_id` | uuid | mapping vers l'org Socle (renseigné par le superadmin) ; NULL = pas de sync Socle |

**Charte graphique (logo + couleurs) — miroir du Socle depuis le 2026-09-13.** La charte d'une
collectivité est définie une seule fois pour toute la gamme, dans le Socle, avec héritage le
long de la hiérarchie (`branding_inherit_parent`). `sync-socle-referentiel` la recopie à chaque
passage, depuis `GET /v1/organizations/{tenant}/branding` (scope API `read`).

- **L'appel porte sur le `socle_org_id` du tenant**, pas sur sa racine (contrairement au relais
  SMTP) : la route résout l'héritage elle-même, et une sous-organisation peut porter sa propre
  charte. « Marie d'Arles » reçoit donc celle d'ACCM tant qu'elle n'en déclare pas — logo compris.
- **Le logo ne passe plus par `planTenantIdentityUpdate`**, qui ne fixe plus que `name` et `slug`.
  `SocleOrgApi.logo_url` est la colonne **brute** de l'organisation : une sous-organisation sans
  logo propre y lisait `null` et se retrouvait sans logo. Ne pas l'y remettre.
- **Clara ne mirrore que 3 des 5 éléments** de la charte Socle : pas de `logo_white_url`
  (aucun fond sombre à habiller) ni de `favicon_url` (l'onglet du navigateur porte le favicon de
  Clara, pas celui de la collectivité). Le jour où l'un sert, il s'ajoute dans `branding.ts` **et**
  dans la table — pas avant.
- **Miroir strict, l'absence comprise** : un élément retiré du référentiel est retiré ici. Sans
  conséquence : les gabarits de mails ont leurs couleurs de repli (`#0acf83`, `#18181b`) et un
  mail sans logo part quand même.
- **Écriture réservée au service role** : le `GRANT UPDATE` de table a été retiré à
  `anon`/`authenticated` et reposé **colonne par colonne, les trois colonnes de charte exclues**
  (migrations `20260913081355_organizations_charte_du_socle.sql` puis
  `20260913082647_organizations_logo_du_socle.sql`). La policy `org_admin_update` laissait sinon
  un admin d'org réécrire le miroir par PostgREST. Le reste de la ligne (coordonnées, gabarit de
  réponse, rétention, `socle_org_id`) s'édite comme avant.

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
| `chrono` | varchar | Référence du registre, `AAAA-E\|S\|I-NNNNN` (ex. `2026-E-00042`). Posée par le trigger `assign_courier_chrono()` **à l'insertion, quelle que soit la porte d'entrée** ; définitive ensuite. Voir ci-dessous. |
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
| `acknowledged_at` | timestamptz | Courrier reçu : **première réponse envoyée** (réponse entrée dans un état `processed`). Posée par le trigger `couriers_track_acknowledgement` (AFTER, sur la réponse), jamais réécrite. Délais de traitement — `docs/features.md` § 3 |
| `resolved_at` | timestamptz | Courrier reçu : entrée dans un état `processed`/`archived` ; **remise à NULL** s'il en ressort. Trigger `couriers_track_resolution` (BEFORE). Passer de traité à archivé ne la déplace pas |
| `consents` | jsonb NOT NULL défaut `[]` | Consentements RGPD recueillis **au dépôt portail** : `[{kind, granted, statement, collected_at}]`. Écrit par `portal-form` seul, **immuable** ensuite. Voir ci-dessous. |
| `fts_subject` / `fts_body` | tsvector | index full-text français |

**Référence du registre (`chrono`) — implémentée le 2026-09-13.** Format `AAAA-E|S|I-NNNNN`,
compteurs dans `courier_sequences` (une suite par organisation × année × sens).

- **Un trigger, pas une RPC** : `assign_courier_chrono()` (BEFORE INSERT) couvre les six portes
  d'entrée d'un courrier — IMAP, numérisation, portail, saisie, import en masse, réponse — d'un
  coup. Une RPC qu'il faut penser à appeler, c'est une porte qu'on oublie, et un registre à trous.
- **Année d'enregistrement, pas du courrier** : `now()`, jamais `received_at`. Un registre ne se
  remplit que par la fin ; importer en 2026 une lettre de 2024 ne doit pas insérer un numéro au
  milieu d'une année close.
- **La lettre de sens n'est pas cosmétique** : les compteurs sont par sens, sans elle un entrant
  nº 42 et un sortant nº 42 porteraient la même référence.
- **Pas de trous** : l'incrément vit dans la même transaction que l'insertion — une transaction
  annulée rend son numéro (vérifié en base). Le verrou de ligne sérialise les insertions
  concurrentes d'une même organisation, ce qui est exactement ce qui garantit l'unicité.
- **Définitive** : `trg_couriers_chrono_immutable` refuse toute modification d'une référence posée.
  Seul le passage de `NULL` à une valeur reste ouvert — c'est la voie d'une reprise.
- **Unicité** : index partiel `couriers_organization_chrono_uniq` (`WHERE chrono IS NOT NULL`),
  par organisation : deux collectivités tiennent deux registres, la même référence des deux côtés
  est légitime.
- ⚠️ **Les 5 080 courriers antérieurs au 2026-09-13 restent à `NULL`** et s'affichent
  « sans référence ». Une reprise passerait par le chemin `NULL → valeur` — décision non prise.
- ⚠️ **Une réponse consomme son numéro dès le premier enregistrement de brouillon**
  (`ensureReply` dans `ReplyComposer` → `createReply`, sur « Enregistrer le brouillon », la
  signature ou l'envoi — pas à l'ouverture du composeur). Un brouillon enregistré puis supprimé
  laisse donc un trou dans la suite `S`. À arbitrer si la continuité du registre sortant compte.

**Consentements RGPD au dépôt (`consents`) — implémentés le 2026-09-22** (migration
`courier_consents`, doctrine reprise d'Iris `requests.consents`).

Le référentiel Socle est propriétaire du consentement d'une **personne** (`contact_consents` +
état dérivé `consent_traitement` / `consent_partage` sur `contacts`, via
`POST /v1/contacts/{id}/consents`). Mais un dépôt portail arrive **sans fiche rapprochée** :
l'expéditeur n'est associé à un contact que plus tard, par un geste d'agent. Entre les deux, la
preuve doit exister quelque part — et rester celle de ce dépôt.

| | Socle `contact_consents` | Clara `couriers.consents` |
|---|---|---|
| Objet | Le consentement d'une **personne**, état courant compris | Le consentement de **ce dépôt** |
| Dépôt non rapproché | Rien à écrire — aucune fiche | La **seule** trace qui existe |
| Rattachement de l'expéditeur | Report par `socle-contacts` (`consents_from_courier`), `source_app = clara`, `source_reference = courier.id`, `collected_at` = date du dépôt | Ne change pas |
| Retrait ultérieur | Nouveau recueil `granted: false`, met l'état à jour | **Ne réécrit rien** |
| Mutabilité | Historique + état dérivé | **Immuable** (`trg_couriers_consents_immutable`, service_role compris) |

- **Forme** : `[{ kind: 'traitement'|'partage', granted, statement, collected_at }]` — la phrase
  EXACTE lue par l'usager, composée par le serveur (catalogue fermé
  `_shared/consents/catalog.ts` + `organizations.name`). CHECK `couriers_consents_array`
  (`coalesce(jsonb_typeof(consents), '') = 'array'` : un CHECK NULL passe, d'où le `coalesce`).
  La base enregistre un fait, elle n'arbitre pas le catalogue.
- **Garde anti-forge à l'INSERT** (`trg_couriers_consents_insert_guard`) : hors contexte de
  service (`is_transition_guard_bypassed()`, claim JWT `service_role`), `consents` doit valoir
  `[]`. La policy `auth_insert` laisse tout éditeur poster `couriers` par PostgREST : sans cette
  garde, un agent pourrait forger un consentement que l'immuabilité figerait ensuite (leçon S1
  du backlog sécurité d'Iris).
- **Immuable, service_role compris** : vider = effacer une preuve ; remplir après coup = un
  consentement rétroactif, qui n'existe pas. Pas de chemin `NULL → valeur` comme pour `chrono`.
- **Pas exposé par `search_couriers`** : les listes n'affichent pas la trace ; elle n'est lue qu'au
  rattachement, sur un courrier ouvert (`select("*")`), et transmise à Iris dans l'enveloppe
  (`kind` + `granted` seulement).
- Test : `supabase/tests/courier_consents.test.sql` (8 scénarios, transaction annulée).
- ⚠️ Les courriers antérieurs au 2026-09-22, saisis par un agent ou reçus par IMAP portent `[]` :
  aucun consentement n'a été demandé, ce n'est pas un refus.

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
| `suggested_service_name` | text — nom de l'organisation proposée (dérivé de l'id depuis le 2026-10-01) |
| `suggested_socle_organization_id` | uuid FK → socle_organizations, `ON DELETE SET NULL` — organisation gestionnaire **proposée** par l'IA, revalidée contre le catalogue. L'agent l'applique ou non |
| `suggested_service_reason` | text — la justification, une phrase |
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
- **Crédit IA épuisé** → job reporté **à la date de renouvellement rendue par le Socle** (jamais recalculée localement), sans consommer de tentative. Sans ce rollback, trois passages de cron condamneraient un courrier parfaitement analysable le mois suivant. ⚠️ Depuis la centralisation IA du 2026-08-29, le guichet renvoie **deux refus distincts en 429** : le plafond (rien à tenter avant le renouvellement) et la **cadence** (`ai_rate_limited` — le crédit est intact, replanification à 5 min, tentative également rendue). Les confondre endormirait un mois durant un courrier simplement arrivé dans une rafale.

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
Compteurs du registre : **un par organisation × année × sens** (UNIQUE). Alimente
`couriers.chrono` depuis le 2026-09-13 — avant cette date la table était vide et la
référence n'était jamais attribuée.

| Colonne | Type |
|---|---|
| `organization_id` | uuid FK → organizations |
| `year` | integer — année d'**enregistrement**, pas celle du courrier |
| `direction` | enum `courier_direction` |
| `last_value` | integer — dernier rang attribué. **Ne jamais diminuer** : les références déjà posées seraient resservies. |

- **Écriture réservée** : plus aucune policy ni `GRANT` pour `anon`/`authenticated`
  (migration `20260913090832_courier_chrono.sql`). Seuls le `service_role` et le trigger
  `assign_courier_chrono()` (SECURITY DEFINER) y touchent.

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

#### `procedure_organizations`
Miroir de l'**activation des démarches par organisation** (le Socle porte `organization_procedures`, servie par `GET /v1/procedures?enabled_for=<org>`). Clé primaire `(organization_id, procedure_id, socle_organization_id)`, RLS `auth_select` = `is_member_of` + `service_role_full` — **aucune écriture client** : rien ne s'active depuis Clara.

| Colonne | Type | Notes |
|---|---|---|
| `organization_id` | uuid FK → organizations | tenant Clara |
| `procedure_id` | uuid FK → procedures | démarche mirrorée |
| `socle_organization_id` | uuid FK → socle_organizations | organisation qui l'assure |
| `synced_at` / `obsoleted_at` | timestamptz | soft-delete : activation retirée côté Socle |

**Sémantique opt-in strict, avec une exception** : une démarche du référentiel n'est proposée que par les organisations listées ici ; une démarche que le référentiel ne connaît pas (Arpège, embryon local) n'a **aucune ligne** et reste proposée partout — sans quoi le flux partenaire se fermerait. Règles partagées : `src/lib/procedure-activation.ts` (dialogue de demande, écran Démarches) et la garde avant-réseau de `push-iris-request`.

⚠️ **Le catalogue `procedures` est l'UNION du sous-arbre**, pas la seule racine : le filtre `enabled_for` du Socle **n'est pas récursif**, la sync interroge donc chaque organisation. Avant le 2026-09-10, Clara ne mirrorait que la racine — les démarches propres à une sous-organisation étaient invisibles (7 mirrorées sur 15 proposées, côté ACCM).

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
| `public_description` | text | **miroir Socle** : descriptif « informations usager » (`GET /v1/portal/organizations`), en texte brut borné à 1 500 caractères. Écrit par la sync seule ; NULL pour un service interne (le Socle ne publie rien pour eux). Catalogue de la proposition de service instructeur |
| `sla_ack_business_days` / `sla_resolution_business_days` | integer (1-365 / 1-3650) | **config Clara** : délais souhaités avant accusé de réception / résolution, en jours ouvrés. **NULL = hérite du parent** ; la racine porte ceux de la collectivité. Voir `docs/features.md` § 3 |
| `synced_at` / `obsoleted_at` | timestamptz | |

La boîte IMAP d'une org est rattachée via `imap_settings.socle_organization_id`. Arbre + panneau de config : `src/components/SocleOrganizationTree.tsx` + `OrganizationConfigDialog.tsx` (sections « Organisations » de SettingsPage et OrgSettings) ; le nœud **racine** porte l'UI des paramètres globaux du tenant (fichier domiciliaire, « Différencier les adresses mail de réception par organisation » = `organizations.multiple_imap`, rétention/purge — stockage inchangé sur `organizations`). Service client : `src/services/socleOrgConfigService.ts`.

#### `socle_organization_members` / `socle_organization_signatories`
Membres et signataires d'une organisation (remplacent `service_members`/`service_signatories`). `UNIQUE (socle_organization_id, user_id|signatory_id)`, RLS select `is_member_of` / écriture `is_admin_of`. Les membres pilotent le filtrage des courriers (`useUserServiceFilter` — liste d'**UUIDs** d'orgs) ; les signataires alimentent le composer de réponse.

#### `services` / `service_members` / `service_signatories` — **GELÉES**
Remplacées par les organisations Socle (données migrées le 2026-07-11, conservées pour historique/rollback). Plus aucun flux d'écriture ; `fetch-inbound-emails` et `portal-form` gardent un fallback legacy en lecture.

#### `socle_sync_runs`
Journal des synchronisations Socle : une ligne par org et par run (`started_at`, `finished_at`, `status` running/success/error, `dry_run`, `counters` jsonb, `error`).

#### `courier_tags`
Dictionnaire de tags (étiquettes) de l'org, en **deux groupes**. Les tags appliqués sont dans `couriers.metadata->'tags'` (array de **noms**) : le groupe est une propriété du tag, jamais de son application — il se relit par rapprochement sur le nom, insensible à la casse.

| Colonne | Type | Notes |
|---|---|---|
| `name` | varchar | `UNIQUE (organization_id, name)` |
| `color` | varchar | `hsl(h s% l%)` — dégradé vert→rouge pour un sentiment, teinte diversifiée pour un thème (palettes dans `src/services/courierTagService.ts`) |
| `tag_group` | text | `theme` (le sujet) ou `sentiment` (le ton), `CHECK`, défaut `theme` |

**Un tag appliqué puis retiré du référentiel — un « orphelin » — compte en `theme`.** Même règle des deux côtés : `src/lib/courier-tags.ts` pour l'affichage, `stats_tag_evolution` pour les statistiques ; le ranger d'office en sentiment fausserait la courbe la plus lue.

Le champ figé `courier_analyses.sentiment` (liste en dur : neutre, courtois, urgent, mécontent, agressif, satisfait, inquiet) a été **remplacé par ce groupe le 2026-09-10** : ses sept valeurs sont devenues des tags de départ, renommables et applicables. La colonne subsiste pour les analyses antérieures mais n'est plus ni écrite ni affichée.

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

**MIROIR du Socle depuis le 2026-08-23 — aucune saisie dans Clara.** Le relais d'une
collectivité est défini une seule fois pour toute la gamme, dans le Socle, sur
l'**organisation racine** (`GET /v1/organizations/{id}/smtp`, scope API `smtp`, contrat
public-api 1.1.0). `sync-socle-referentiel` le recopie à chaque passage.

| Colonne | Notes |
|---|---|
| `host` / `port` / `username` / `password` | Reçus du Socle. Mot de passe **en clair** (dette P1, cf. `docs/technical-debt.md`) — il ne doit apparaître dans aucun journal. Chaîne vide = relais sans authentification. |
| `from_email` / `from_name` / `use_tls` | `from_email` normalisée en minuscules ; `use_tls` absent ⇒ `true` (jamais de repli silencieux en clair). |
| `socle_org_id` | Racine Socle d'où vient la configuration. `NULL` = ligne héritée de l'ancienne saisie manuelle, jamais synchronisée. |
| `socle_updated_at` | Date de dernière modification côté Socle (diagnostic). |
| `synced_at` | Date de la synchronisation qui a écrit la ligne. `NULL` = jamais synchronisée. |

- **Écriture** : deux RPC `SECURITY DEFINER` réservées à `service_role`
  (`EXECUTE` révoqué de `public, anon, authenticated`) —
  `sync_smtp_settings_from_socle(...)` (upsert) et `clear_smtp_settings_from_socle(org)`
  (retrait). Aucun `GRANT` de table pour `anon`/`authenticated` : la table est invisible
  côté client, seule la policy `service_role_full_smtp` subsiste.
- **Miroir strict** : ce que le Socle déclare fait foi, **y compris l'absence**. Mot de passe
  retiré côté Socle ⇒ retiré ici ; `configured: false` ou relais inexploitable (hôte vide,
  adresse d'expédition non conforme) ⇒ **ligne effacée**. Un miroir qui survit à sa source ment.
- **Racines seulement** : la route Socle répond `404` pour une sous-organisation. Un tenant
  Clara mappé sur une sous-organisation (« Marie d'Arles ») **hérite du relais de sa racine**,
  comme il hérite déjà de son référentiel de contacts.
- **Pas de repli** : Clara n'a aucun relais de secours (aucun secret `SMTP_*`). Un tenant sans
  relais déclaré dans le Socle **n'expédie rien** — les fonctions d'envoi répondent « Aucun
  serveur d'envoi pour cette organisation : définissez-le dans le référentiel (organisation
  principale), puis lancez une synchronisation. »

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
| `scan_allowed_senders` | text[] | Adresses des copieurs autorisés à déposer. **Fail-closed** : `NULL` **ou** `[]` (vide) → la boîte de scan n'accepte **rien** (une boîte de numérisation n'attend que ses copieurs ; sans expéditeur configuré, aucun courrier n'est créé). Logique testable : `fetch-inbound-emails/logic.ts` (`isInboundSenderAccepted`). |
| `max_email_bytes` | integer | Plafond par email pour cette boîte. `NULL` = plafond global de l'edge function (15 Mo). |

**Mode boîte de numérisation** (`is_scan_inbox = true`), appliqué par `fetch-inbound-emails` :
`channel = 'paper'` (l'email n'est qu'un transport), **aucun participant `sender`** (le copieur n'est pas l'expéditeur — son adresse va dans `metadata.scan_device_email`), sujet remplacé par « Courrier numérisé — à qualifier » (le sujet MFP est du bruit), corps non indexé, et un `courier_analysis_jobs` enfilé dès qu'une pièce jointe est stockée.

---

### Intégrations & notifications

#### `organization_integrations`
Connexions API par tenant : partenaires tiers (Arpège…) **et Iris** (autre produit de la
gamme). Une ligne par `(organization_id, provider)`. **Superadmin + service_role uniquement** :
la table porte des secrets, l'UI ne les re-sert jamais au navigateur.

| Colonne | Type | Notes |
|---|---|---|
| `provider` | text | `'arpege'`, `'iris'` |
| `client_id` / `client_secret` / `access_token` | text | identifiants Hawk (Arpège) |
| `api_base_url` / `api_url_ticketingapp` | text | |
| `api_key` | text | **Iris** : la clé d'intégration `irs_…`. Secret serveur, expiration obligatoire côté Iris |
| `socle_root_org_id` | uuid | **Iris** : organisation RACINE visée. Vérifiée par Iris contre le périmètre de la clé (403 en cas d'écart) — ne se déduit **pas** de `organizations.socle_org_id`, un tenant pouvant être mappé sur une sous-organisation |
| `last_sync_at` | timestamptz | curseur de réconciliation : `updated_at` (horloge du **partenaire**) de la dernière demande relue |
| `is_active` | boolean | suspension : coupe le **nouveau trafic**, jamais le suivi des demandes déjà déposées |

#### `action_tickets`
Demandes dérivées d'un courrier. Depuis le 2026-09-11 elles sont **toujours** fondées sur une
démarche — Iris ou partenaire ; les colonnes restées nullables ne le sont que pour les tickets
d'avant (cf. `docs/features.md` § 4).

| Colonne | Type | Notes |
|---|---|---|
| `courier_id` | uuid FK | immuable (trigger) |
| `procedure_id` | uuid FK → procedures | nullable en DB pour les tickets d'avant le 2026-09-11 ; **exigé par le formulaire** — sans démarche, personne n'instruit la demande |
| `title` | text | **plus saisi** : affiché seulement s'il est renseigné (tickets d'avant) |
| `description` | text | idem — plus saisi, affiché s'il est renseigné |
| `assignee_id` | uuid FK → users | **plus saisi** : l'affectation a disparu avec la demande libre ; affiché s'il est renseigné |
| `status` | text | `'open'` par défaut |
| `socle_data` | jsonb | démarche du référentiel : demandeur déclaré + réponses au formulaire + pièces sélectionnées (`src/lib/socle-form.ts`) |
| `socle_organization_id` | uuid FK → socle_organizations | **organisation destinataire choisie par l'agent** — commande la liste des démarches proposées et l'organisme transmis à Iris. Nullable : à null, on retombe sur celle du courrier (tickets antérieurs au 2026-09-10). Adresser une demande à un service ne déplace pas le courrier |
| `arpege_demande_ref` / `arpege_demande_status` | text | |

**Garde de création** (2026-09-24, `20260924190000_garde_creation_action_reponse.sql`) : le
trigger `trg_action_tickets_creation_guard` (BEFORE INSERT) — et son jumeau
`trg_couriers_reply_creation_guard` sur `couriers`, pour une réponse sortante (`outbound` avec
`parent_courier_id`) — refuse la création si le courrier parent n'a pas d'organisation
gestionnaire, ou s'il est dans la boîte aux lettres : `workflow_state_id` nul, état introuvable,
ou `is_initial IS TRUE` (un `is_initial` NULL compte comme « pas initial », comme le filtre de la
boîte). Le motif vient de `courier_creation_block_reason(uuid)` (SECURITY DEFINER, `service_role`
seulement — `create-arpege-demande` l'appelle AVANT d'écrire chez Arpège) et reprend mot pour mot
`_shared/courierCreationGuard.ts`. **Le service_role n'est pas dispensé** ; seul le GUC
`clara.bypass_transition_guard` y échappe. INSERT seulement : 4 actions et 3 réponses de production
antérieures à la règle restent sur des courriers qui seraient refusés aujourd'hui.

**Suivi de la demande déposée dans Iris** (écrit par le serveur uniquement — cf.
`docs/iris-integration.md`) :

| Colonne | Type | Notes |
|---|---|---|
| `iris_idempotency_key` | uuid, `not null default gen_random_uuid()` | tirée à la création du ticket, **rejouée telle quelle** à chaque tentative : c'est ce qui rend un renvoi inoffensif |
| `iris_request_id` / `iris_reference` / `iris_url` | uuid / text / text | identité de la demande côté Iris. `iris_request_id` NULL = jamais déposée |
| `iris_status` | text | liste **fermée** (`a_traiter`, `en_instruction`, `en_attente`, `annulee`, `resolue_positive`, `resolue_negative`, `archivee`). Libellés d'affichage : `src/lib/iris.ts` |
| `iris_version` | integer | version monotone servie par Iris — garde d'application des mises à jour |
| `iris_synced_at` / `iris_last_attempt_at` | timestamptz | |
| `iris_last_error` | text | message en français du dernier échec de dépôt ; non nul ⇒ l'onglet Actions liées propose « Renvoyer ». NULL après un dépôt réussi |
| `iris_attachments_error` | text | pièces réclamées par le formulaire de la démarche qu'Iris a refusées au dernier dépôt (format hors liste, 25 Mo, fichier introuvable) : la demande est **déposée mais incomplète**, et la ligne du ticket le dit. NULL = rien à signaler — **jamais** la preuve que tout est arrivé : les demandes d'avant le 2026-09-11 sont parties sans aucune pièce |

#### `notifications`
Notifications in-app **et** boîte d'envoi push. RLS scoped `user_id = auth.uid()`.

| Colonne | Type |
|---|---|
| `user_id` | uuid FK → users |
| `type` | text (`'new_courier'` par défaut) |
| `resource_id` | uuid |
| `read` | boolean |
| `push_status` | text — `pending` \| `sending` \| `sent` \| `skipped` \| `failed`. **Décidé par le trigger `trg_notifications_push_queue` (BEFORE INSERT), jamais par le producteur** : `pending` ssi le destinataire a au moins un appareil actif |
| `push_attempts` / `push_attempted_at` / `push_sent_at` / `push_next_attempt_at` | compteur et horodatages de la file (temporisation 2, 4, 8, 16 min ; abandon à la 5ᵉ) |
| `push_error` | text — dernière cause d'échec, ou le motif d'un renoncement (« lue avant envoi », « aucun appareil actif »). **Jamais un endpoint ni le texte de la carte** |

#### `push_subscriptions`
Abonnements Web Push, **un par appareil**. ⚠️ **Seule table non scopée par `organization_id`** :
un téléphone appartient à un compte, pas à une collectivité, et un agent rattaché à deux
organisations ne l'inscrit pas deux fois. Le cloisonnement reste porté par `notifications`.

| Colonne | Type |
|---|---|
| `user_id` | uuid FK → users |
| `endpoint` | text **UNIQUE** — l'adresse de l'appareil rendue par le navigateur (FCM, Mozilla, Apple). Pas un secret |
| `p256dh` / `auth` | text — clé publique ECDH et sel de chiffrement **vers** cet appareil (RFC 8291) ; publics par construction |
| `user_agent` | text — libellé d'affichage (« Android · Chrome »), pour l'affichage seul |
| `created_at` / `last_seen_at` | timestamptz |
| `disabled_at` / `disabled_reason` | posés par le facteur sur 404/410 du service de push ; un nouvel enregistrement réactive la ligne |

**Pas de policy INSERT cliente** : l'écriture passe par la RPC `register_push_subscription`
(DEFINER), seule à pouvoir **reprendre** un endpoint pour son nouveau titulaire — sur un poste
partagé d'accueil, le navigateur rend le même endpoint au suivant, et une clé
`(user_id, endpoint)` lui ferait recevoir les notifications de son collègue de la veille.
SELECT / UPDATE / DELETE restent en direct sous RLS (soi seul).

Fonctions de service (aucune `EXECUTE` cliente) : `claim_notification_pushes`,
`settle_notification_push`, `disable_push_subscription`, `notification_push_max_attempts`.

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
