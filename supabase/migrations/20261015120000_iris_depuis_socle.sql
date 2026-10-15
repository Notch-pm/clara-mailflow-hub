-- ============================================================================
-- Connexion Iris déduite des abonnements du Socle (2026-10-15).
--
-- Cocher Iris et Clara pour une collectivité dans le Socle suffit : la
-- synchronisation du référentiel (sync-socle-referentiel/iris.ts) lit le champ
-- `applications` (public-api 1.42.0) et écrit la ligne
-- `organization_integrations` (provider `iris`) par ces deux RPC de service —
-- jamais d'écriture directe (règle épinglée par socle-arpege-mirror.test.ts).
--
-- La ligne n'a plus de clé : `api_key` NULL ⇒ clé PLATEFORME de Clara
-- (secret IRIS_PLATFORM_API_KEY) + en-tête X-Socle-Root-Organization-Id.
-- Le curseur de suivi `last_sync_at` est conservé d'un passage à l'autre.
--
-- Rejouable.
-- ============================================================================

create or replace function public.sync_iris_integration_from_socle(
  p_org_id            uuid,
  p_api_base_url      text,
  p_socle_root_org_id uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if btrim(coalesce(p_api_base_url, '')) = '' or p_socle_root_org_id is null then
    raise exception 'Connexion Iris incomplète : URL et racine Socle requises.' using errcode = '22023';
  end if;

  insert into public.organization_integrations as i (
    organization_id, provider, api_base_url, api_key, socle_root_org_id, is_active, socle_synced_at
  ) values (
    p_org_id, 'iris', btrim(p_api_base_url), null, p_socle_root_org_id, true, now()
  )
  on conflict (organization_id, provider) do update set
    api_base_url      = excluded.api_base_url,
    api_key           = null,          -- l'ancienne clé par collectivité disparaît : clé plateforme
    socle_root_org_id = excluded.socle_root_org_id,
    is_active         = true,
    socle_synced_at   = now();
end
$fn$;

comment on function public.sync_iris_integration_from_socle(uuid, text, uuid) is
  'Ouvre la connexion Iris d''un tenant abonné à Iris dans le Socle (clé plateforme, sans clé par collectivité) — SERVICE UNIQUEMENT (synchronisation du référentiel).';
revoke execute on function public.sync_iris_integration_from_socle(uuid, text, uuid) from public, anon, authenticated;
grant  execute on function public.sync_iris_integration_from_socle(uuid, text, uuid) to service_role;

-- Iris décoché dans le Socle : SUSPENDRE, jamais effacer — le suivi des
-- demandes déjà déposées continue (même sémantique qu'Arpège). Renvoie vrai
-- si une connexion active vient d'être suspendue.
create or replace function public.suspend_iris_integration_from_socle(p_org_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_was_active boolean;
begin
  select is_active into v_was_active
    from public.organization_integrations
   where organization_id = p_org_id and provider = 'iris'
   for update;
  if not found then
    return false;
  end if;
  update public.organization_integrations
     set is_active = false, socle_synced_at = now()
   where organization_id = p_org_id and provider = 'iris';
  return coalesce(v_was_active, false);
end
$fn$;

comment on function public.suspend_iris_integration_from_socle(uuid) is
  'Suspend la connexion Iris d''un tenant désabonné d''Iris dans le Socle (suivi conservé) — SERVICE UNIQUEMENT.';
revoke execute on function public.suspend_iris_integration_from_socle(uuid) from public, anon, authenticated;
grant  execute on function public.suspend_iris_integration_from_socle(uuid) to service_role;
