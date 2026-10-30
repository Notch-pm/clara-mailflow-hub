-- Agents gérés par le Socle (annuaire des agents, lot 3 côté Clara).
--
-- Le Socle décide qui accède à Clara, sur quel organisme, avec quel rôle de
-- base (`GET /v1/users`, public-api 1.43.0). La fonction `sync-socle-users`
-- l'applique aux tenants rattachés au Socle (`organizations.socle_org_id`).
-- Les droits fins (signataire, viseur, service courrier, confidentiel) restent
-- dans Clara.

-- 1. Clé de correspondance : l'identifiant de l'agent dans le Socle.
--    L'e-mail ne sert qu'au premier rapprochement (reprise des comptes).
alter table public.users add column if not exists socle_user_id uuid;
create unique index if not exists users_socle_user_id_key on public.users (socle_user_id);

comment on column public.users.socle_user_id is
  'Identifiant de l''agent dans le Socle (GET /v1/users). Posé = compte géré par le Socle : accès, rôle de base et affectations viennent de lui.';

-- 2. Curseur de lecture incrémentale, par tenant.
create table if not exists public.socle_user_sync_state (
  organization_id   uuid primary key references public.organizations(id) on delete cascade,
  -- `as_of` rendu par le Socle au dernier appel réussi : prochain `updated_since`.
  cursor            text,
  last_full_sync_at timestamptz,
  last_run_at       timestamptz,
  last_error        text,
  updated_at        timestamptz not null default now()
);

comment on table public.socle_user_sync_state is
  'État de la synchronisation des agents depuis le Socle, par tenant. Écrit par la fonction sync-socle-users (service role) seulement.';

-- Écriture : service role seulement. Lecture : le superadmin (diagnostic).
alter table public.socle_user_sync_state enable row level security;
revoke all on table public.socle_user_sync_state from anon, authenticated;
grant select on table public.socle_user_sync_state to authenticated;
create policy "superadmin reads socle_user_sync_state" on public.socle_user_sync_state
  for select to authenticated
  using (public.is_superadmin(auth.uid()));

-- 3. Le rattachement au Socle ne s'écrit que côté serveur.
--    Un administrateur de tenant qui posait `socle_user_id` sur un compte en
--    confierait la gestion à un autre agent du Socle. Service role et
--    migrations (auth.uid() nul) seulement — motif `prevent_superadmin_escalation`.
create or replace function public.prevent_socle_user_id_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.socle_user_id is distinct from old.socle_user_id and auth.uid() is not null then
    raise exception 'Le rattachement au Socle d''un compte ne se modifie pas depuis Clara.';
  end if;
  return new;
end $$;

revoke all on function public.prevent_socle_user_id_change() from public, anon, authenticated;

drop trigger if exists trg_prevent_socle_user_id_change on public.users;
create trigger trg_prevent_socle_user_id_change
  before update of socle_user_id on public.users
  for each row execute function public.prevent_socle_user_id_change();
