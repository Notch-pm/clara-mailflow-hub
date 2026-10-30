-- Agents gérés par le Socle — planification de `sync-socle-users`.
-- ⚠️ À appliquer APRÈS le déploiement de la fonction et un premier passage à
-- blanc (`dry_run`) puis réel : sinon pg_cron l'appelle chaque minute dans le vide.
--
-- Deux cadences :
--   - chaque minute, lecture INCRÉMENTALE (`updated_since`) : un accès ouvert
--     ou retiré dans le Socle prend effet en moins de deux minutes ;
--   - chaque nuit (03:20, après la synchro du référentiel de 03:00), lecture
--     COMPLÈTE : rattrape les suppressions en cascade côté Socle.

create or replace function public.trigger_socle_users_sync(p_mode text default 'incremental')
returns bigint
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  v_secret text;
  v_request_id bigint;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1;
  select net.http_post(
    url := 'https://aullweizxcjbvtdspjli.supabase.co/functions/v1/sync-socle-users',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', coalesce(v_secret, '')),
    body := jsonb_build_object('mode', case when p_mode = 'full' then 'full' else 'incremental' end)
  ) into v_request_id;
  return v_request_id;
end;
$$;

revoke execute on function public.trigger_socle_users_sync(text) from public, anon, authenticated;

do $$
begin
  perform cron.unschedule(jobname) from cron.job
  where jobname in ('sync-socle-users-every-minute', 'sync-socle-users-nightly');
exception when others then null;
end $$;

select cron.schedule('sync-socle-users-every-minute', '* * * * *', $$ select public.trigger_socle_users_sync('incremental'); $$);
select cron.schedule('sync-socle-users-nightly', '20 3 * * *', $$ select public.trigger_socle_users_sync('full'); $$);
