-- ============================================================================
-- Connecteur Iris — Clara pousse ses demandes vers Iris (source enregistrée).
--
-- Iris est propriétaire exclusif des « demandes d'usagers » de la gamme. Une
-- action de courrier fondée sur une DÉMARCHE du référentiel y est déposée par
-- l'API d'ingestion générique (`POST /v1/requests`, contrat public 1.1.0) ;
-- Clara n'en garde qu'une trace de suivi. Les « demandes libres » (ticket sans
-- démarche) restent chez Clara : `socle_procedure_id` est obligatoire côté
-- Iris, qui ne gère aucune demande sans démarche.
--
-- Une fois déposée, la demande est instruite dans Iris : Clara en suit l'état,
-- elle ne la pilote pas. D'où des colonnes de SUIVI, en lecture seule pour le
-- produit — elles ne sont écrites que par les edge functions (service_role).
--
-- Motif suivi : le connecteur Arpège (`organization_integrations`,
-- `action_tickets.arpege_demande_*`), cf. docs/partenaires-integration.md.
--
-- Rejouable : IF NOT EXISTS / OR REPLACE partout (cf. docs/deployment.md).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Connexion Iris par tenant (`organization_integrations`, provider 'iris')
--
-- La clé d'intégration Iris est un SECRET SERVEUR : « jamais dans un
-- navigateur, un bundle, une variable VITE_* ni un dépôt » (contrat Iris). La
-- table est déjà verrouillée superadmin + service_role (lot L2 partenaires) —
-- c'est ce qui permet de l'y ranger.
--
-- Deux colonnes manquaient au modèle Arpège (Hawk) :
--   • `api_key` : la clé `irs_…` elle-même ;
--   • `socle_root_org_id` : le périmètre. Iris VÉRIFIE le
--     `socle_root_organization_id` déclaré contre celui de la clé (403 sinon).
--     Il ne se déduit pas de `organizations.socle_org_id` : un tenant Clara
--     peut être mappé sur une SOUS-organisation (« Marie d'Arles »), dont la
--     racine est ailleurs. On le configure donc explicitement, plutôt que de
--     le recalculer à chaque envoi depuis le catalogue Socle.
-- ----------------------------------------------------------------------------
alter table public.organization_integrations
  add column if not exists api_key           text,
  add column if not exists socle_root_org_id uuid,
  -- Curseur de réconciliation : `updated_at` (horloge d'IRIS, jamais celle de
  -- Clara) de la demande la plus récemment relue. Repartir de l'horloge locale
  -- ferait perdre des mises à jour au moindre décalage entre les deux bases.
  add column if not exists last_sync_at      timestamptz;

comment on column public.organization_integrations.api_key is
  'Clé d''intégration du partenaire (Iris : « irs_… »). SECRET SERVEUR — jamais servi à un navigateur ; la table est réservée au superadmin et au service_role.';
comment on column public.organization_integrations.socle_root_org_id is
  'Organisation RACINE (UUID Socle) que cette intégration vise. Iris vérifie ce périmètre contre sa clé : un écart vaut 403.';
comment on column public.organization_integrations.last_sync_at is
  'Curseur de réconciliation : updated_at (horloge du partenaire) de la dernière demande relue. Sert de `updated_since` à l''appel suivant.';

-- ----------------------------------------------------------------------------
-- 2. Suivi de la demande Iris sur l'action (`action_tickets`)
--
-- `external_id` côté Iris = `action_tickets.id` — l'id du TICKET, jamais celui
-- du courrier : un courrier peut engendrer plusieurs demandes.
-- ----------------------------------------------------------------------------
alter table public.action_tickets
  -- Tirée dès la création du ticket et REJOUÉE telle quelle à chaque tentative :
  -- c'est ce qui rend un renvoi après timeout inoffensif (200 au lieu de 409).
  add column if not exists iris_idempotency_key uuid not null default gen_random_uuid(),
  add column if not exists iris_request_id      uuid,
  add column if not exists iris_reference       text,
  add column if not exists iris_status          text,
  -- Version monotone servie par Iris : une mise à jour n'est appliquée que si
  -- elle dépasse celle déjà connue (absorbe rejeux et désordre).
  add column if not exists iris_version         integer,
  add column if not exists iris_url             text,
  add column if not exists iris_synced_at       timestamptz,
  add column if not exists iris_last_attempt_at timestamptz,
  add column if not exists iris_last_error      text;

comment on column public.action_tickets.iris_idempotency_key is
  'Clé d''idempotence de la soumission à Iris, tirée à la création et rejouée à chaque tentative.';
comment on column public.action_tickets.iris_request_id is
  'Id de la demande dans Iris. NULL = jamais déposée (demande libre, ou dépôt en échec — voir iris_last_error).';
comment on column public.action_tickets.iris_reference is
  'Référence lisible servie par Iris (ex. DEM-2026-000123).';
comment on column public.action_tickets.iris_status is
  'Dernier statut connu côté Iris. Liste FERMÉE (a_traiter, en_instruction, en_attente, annulee, resolue_positive, resolue_negative, archivee) — ne jamais inventer de valeur ; les libellés d''affichage ne sont pas contractuels.';
comment on column public.action_tickets.iris_version is
  'Version monotone de la demande côté Iris — garde d''application des mises à jour.';
comment on column public.action_tickets.iris_url is
  'Permalien de consultation dans Iris.';
comment on column public.action_tickets.iris_synced_at is
  'Dernière réconciliation ayant touché cette ligne.';
comment on column public.action_tickets.iris_last_error is
  'Message du dernier échec de dépôt, en français, destiné à l''agent. NULL après un dépôt réussi.';

-- Réconciliation : on retrouve une demande par son id Iris.
create index if not exists idx_action_tickets_iris_request
  on public.action_tickets (iris_request_id)
  where iris_request_id is not null;

-- Demandes à renvoyer : ticket sur démarche, dépôt jamais abouti.
create index if not exists idx_action_tickets_iris_a_renvoyer
  on public.action_tickets (organization_id)
  where iris_request_id is null and iris_last_error is not null;
