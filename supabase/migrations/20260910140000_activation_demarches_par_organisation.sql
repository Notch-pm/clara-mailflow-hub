-- ============================================================================
-- Activation des démarches PAR ORGANISATION (miroir du référentiel Socle).
--
-- Le Socle porte l'activation démarche × organisation (`organization_procedures`,
-- servie par `GET /v1/procedures?enabled_for=<org>`), et Iris la FAIT RESPECTER
-- au dépôt d'une demande (trigger `t18_requests_require_procedure_active` :
-- « Cette démarche n'est pas activée pour cet organisme dans le référentiel
-- Socle. »). Clara, elle, ne mirrorait que les démarches activées pour la
-- RACINE de son tenant, dans une table `procedures` plate — d'où deux défauts
-- symétriques, constatés sur ACCM le 2026-09-10 :
--   • des démarches activées sur une sous-organisation seulement étaient
--     INVISIBLES dans Clara (7 démarches mirrorées, 15 proposées par le
--     sous-arbre) ;
--   • une démarche activée sur la racine était proposée à l'agent puis REFUSÉE
--     par Iris, sans qu'il ait choisi l'organisme destinataire.
--
-- Sémantique : OPT-IN STRICT, en miroir. Ce que le Socle n'active pas n'est pas
-- proposé, et rien ne s'active depuis Clara — aucune écriture client, comme
-- `socle_organizations` ou `smtp_settings`. (Cela remplace la cible « table
-- locale opt-out + toggle admin » du lot L6 de docs/technical-debt.md, écrite
-- avant que le Socle ne devienne propriétaire de l'activation.)
--
-- Rejouable : IF NOT EXISTS partout (cf. docs/deployment.md).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Miroir « quelle organisation propose quelle démarche »
--
-- Les trois colonnes de la clé sont des ids CLARA (tenant, démarche mirrorée,
-- organisation mirrorée) : la traversée vers les UUID Socle se fait par les
-- miroirs, comme le fait déjà `push-iris-request` pour l'organisme du courrier.
-- ----------------------------------------------------------------------------
create table if not exists public.procedure_organizations (
  organization_id       uuid not null references public.organizations(id) on delete cascade,
  procedure_id          uuid not null references public.procedures(id) on delete cascade,
  socle_organization_id uuid not null references public.socle_organizations(id) on delete cascade,
  synced_at             timestamptz not null default now(),
  -- Désactivée côté Socle : soft-delete, jamais de suppression physique — le
  -- miroir doit pouvoir dire « connue, plus proposée » à une demande déjà
  -- déposée sous cette activation.
  obsoleted_at          timestamptz,
  created_at            timestamptz not null default now(),
  primary key (organization_id, procedure_id, socle_organization_id)
);

comment on table public.procedure_organizations is
  'Miroir du référentiel Socle : démarches proposées par chaque organisation du sous-arbre du tenant. Opt-in strict — écrit par sync-socle-referentiel (service_role) uniquement.';
comment on column public.procedure_organizations.obsoleted_at is
  'Activation retirée côté Socle. Non nul = la démarche n''est plus proposée par cette organisation.';

-- Le sens de lecture du produit : « les démarches de CETTE organisation ».
create index if not exists idx_procedure_organizations_org
  on public.procedure_organizations (organization_id, socle_organization_id)
  where obsoleted_at is null;

alter table public.procedure_organizations enable row level security;

-- Lecture seule côté client : seule l'edge function (service_role) écrit.
drop policy if exists auth_select on public.procedure_organizations;
create policy auth_select on public.procedure_organizations for select to authenticated
  using (public.is_member_of(organization_id));

drop policy if exists service_role_full on public.procedure_organizations;
create policy service_role_full on public.procedure_organizations for all
  using (auth.role() = 'service_role');

-- ----------------------------------------------------------------------------
-- 2. Organisation DESTINATAIRE de l'action
--
-- Jusqu'ici l'organisme transmis à Iris était celui du COURRIER
-- (`couriers.socle_organization_id`) : l'agent ne pouvait pas adresser sa
-- demande au service compétent sans déplacer le courrier lui-même. La colonne
-- reste nullable — à null, on retombe sur celle du courrier, ce qui préserve
-- les demandes déjà déposées.
-- ----------------------------------------------------------------------------
alter table public.action_tickets
  add column if not exists socle_organization_id uuid
    references public.socle_organizations(id) on delete set null;

comment on column public.action_tickets.socle_organization_id is
  'Organisation (miroir Socle) destinataire de la demande, choisie par l''agent. À null, l''organisme transmis à Iris est celui du courrier.';
