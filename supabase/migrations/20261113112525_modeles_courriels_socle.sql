-- ============================================================================
-- Modèles de courriels du SOCLE — miroir Clara (2026-11-13).
--
-- Le Socle tient, par collectivité (racine), les modèles de courriels de la
-- gamme (`GET /v1/email-templates`, public-api ≥ 1.45.0). Clara recopie, à
-- chaque synchronisation du référentiel, les MODÈLES CRÉÉS cochés pour
-- l'application `clara`, avec les organismes où chacun est proposé. L'agent
-- s'en sert comme BASE d'un courrier sortant ou d'une réponse : le texte est
-- fusionné dans le navigateur et pré-remplit l'éditeur, rien ne part seul.
--
-- Invariants :
--   • Le Socle fait foi : titre, texte, applications ET activation par
--     organisme s'y règlent (Paramètres de l'organisation racine › Modèles de
--     courriels). Clara n'écrit rien côté client — la table n'a qu'une policy
--     de LECTURE ; l'unique porte d'écriture est la RPC de service ci-dessous.
--   • Pas de descendance implicite (règle du Socle) : un modèle n'est proposé
--     que dans les organisations cochées NOMMÉMENT. `socle_organization_ids`
--     porte les identifiants SOCLE (comparés à `socle_organizations.socle_id`) :
--     ils survivent à une recréation du miroir d'organisations.
--   • Les courriels SYSTÈME (accusé de réception d'Iris, avis de statut…) ne
--     sont pas recopiés : ce sont des messages automatiques d'une application,
--     pas des bases de rédaction.
--
-- Rejouable : IF NOT EXISTS / OR REPLACE partout (cf. docs/deployment.md).
-- ============================================================================

create table if not exists public.socle_email_templates (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organizations(id) on delete cascade,
  socle_id               uuid not null,
  name                   text not null,
  description            text,
  subject                text not null,
  body                   text not null,
  socle_organization_ids uuid[] not null default '{}',
  socle_updated_at       timestamptz,
  synced_at              timestamptz not null default now(),
  unique (organization_id, socle_id)
);

comment on table public.socle_email_templates is
  'MIROIR des modèles de courriels créés dans le Socle et cochés pour Clara. Écrit uniquement par sync_email_templates_from_socle (synchronisation du référentiel) — aucune saisie dans Clara.';
comment on column public.socle_email_templates.socle_id is
  'Identifiant du modèle dans le Socle (email_templates.id).';
comment on column public.socle_email_templates.subject is
  'Objet, texte brut à variables {{domaine.cle}} (catalogue unique du Socle) — non fusionné.';
comment on column public.socle_email_templates.body is
  'Corps, texte brut à variables et sections {{#cle}}…{{/cle}} ; une ligne vide sépare deux paragraphes — non fusionné.';
comment on column public.socle_email_templates.socle_organization_ids is
  'Organisations SOCLE où le modèle est proposé, cochées nommément dans le Socle (pas de descendance). Vide = proposé nulle part.';

create index if not exists socle_email_templates_org
  on public.socle_email_templates (organization_id);

alter table public.socle_email_templates enable row level security;

drop policy if exists socle_email_templates_select on public.socle_email_templates;
create policy socle_email_templates_select on public.socle_email_templates
  for select to authenticated
  using (public.is_member_of(organization_id));

revoke all on table public.socle_email_templates from anon;
revoke insert, update, delete, truncate on table public.socle_email_templates from authenticated;
grant select on table public.socle_email_templates to authenticated;

-- ----------------------------------------------------------------------------
-- sync_email_templates_from_socle — unique porte d'écriture (SERVICE).
--
-- Miroir STRICT du tenant : le jeu reçu REMPLACE l'existant (un modèle retiré
-- ou décoché de Clara dans le Socle disparaît). L'appelant ne l'invoque qu'avec
-- une réponse 200 du Socle : un Socle muet laisse le miroir en l'état.
--
-- ⚠️ La garde est le GRANT (service_role seul), pas un test de `current_user`.
-- ----------------------------------------------------------------------------
create or replace function public.sync_email_templates_from_socle(
  p_org_id    uuid,
  p_templates jsonb
) returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_count integer;
begin
  if p_templates is null or jsonb_typeof(p_templates) <> 'array' then
    raise exception 'p_templates doit être un tableau JSON.' using errcode = '22023';
  end if;

  delete from public.socle_email_templates t
   where t.organization_id = p_org_id
     and not exists (
       select 1 from jsonb_array_elements(p_templates) e
        where (e->>'socle_id')::uuid = t.socle_id
     );

  insert into public.socle_email_templates as t (
    organization_id, socle_id, name, description, subject, body,
    socle_organization_ids, socle_updated_at, synced_at
  )
  select
    p_org_id,
    (e->>'socle_id')::uuid,
    e->>'name',
    nullif(e->>'description', ''),
    e->>'subject',
    e->>'body',
    coalesce(
      (select array_agg(o::uuid) from jsonb_array_elements_text(coalesce(e->'socle_organization_ids', '[]'::jsonb)) o),
      '{}'
    ),
    nullif(e->>'socle_updated_at', '')::timestamptz,
    now()
  from jsonb_array_elements(p_templates) e
  on conflict (organization_id, socle_id) do update set
    name                   = excluded.name,
    description            = excluded.description,
    subject                = excluded.subject,
    body                   = excluded.body,
    socle_organization_ids = excluded.socle_organization_ids,
    socle_updated_at       = excluded.socle_updated_at,
    synced_at              = excluded.synced_at;

  select count(*) into v_count from public.socle_email_templates where organization_id = p_org_id;
  return v_count;
end;
$fn$;

revoke all on function public.sync_email_templates_from_socle(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.sync_email_templates_from_socle(uuid, jsonb) to service_role;
