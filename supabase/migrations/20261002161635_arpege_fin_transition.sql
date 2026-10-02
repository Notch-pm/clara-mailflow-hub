-- ============================================================================
-- Arpège : fin de la transition — le Socle est l'UNIQUE source de la
-- configuration, plus aucune saisie dans Clara.
--
-- Suite de 20261002154123_arpege_depuis_socle.sql. La règle de transition
-- (« rien de complet côté Socle ⇒ la ligne locale est conservée ») n'a plus
-- d'objet : ACCM, seule collectivité configurée, est recopiée depuis le Socle
-- et aucune ligne manuelle ne subsiste (vérifié le 2026-10-02 :
-- `socle_synced_at is null` → 0 ligne).
--
-- 1. Plus aucune écriture CLIENTE des lignes `provider = 'arpege'`, même par un
--    super admin : la policy `integrations_superadmin_all` est scindée en une
--    lecture (inchangée, tous providers) et des écritures qui excluent Arpège.
--    Iris reste saisi par le super admin. Le service role (sync, fonctions
--    Arpège) garde sa policy `service_role_full_access`.
--
-- 2. Nouvelle RPC de service `suspend_arpege_integration_from_socle` : quand le
--    Socle répond 200 sans configuration complète, la ligne recopiée est
--    SUSPENDUE (`is_active = false`) sans effacer les identifiants — décision PO
--    L5 : une interface suspendue continue de suivre les demandes déjà déposées
--    (docs/partenaires-integration.md §5), ce qui exige ses identifiants.
--
-- Rejouable : DROP POLICY IF EXISTS / OR REPLACE (cf. docs/deployment.md).
-- ============================================================================

drop policy if exists integrations_superadmin_all    on public.organization_integrations;
drop policy if exists integrations_superadmin_select on public.organization_integrations;
drop policy if exists integrations_superadmin_insert on public.organization_integrations;
drop policy if exists integrations_superadmin_update on public.organization_integrations;
drop policy if exists integrations_superadmin_delete on public.organization_integrations;

create policy integrations_superadmin_select on public.organization_integrations
  for select to authenticated
  using (public.is_superadmin((select auth.uid())));

-- Arpège : écrit par le seul service role (RPC de la sync du référentiel).
create policy integrations_superadmin_insert on public.organization_integrations
  for insert to authenticated
  with check (public.is_superadmin((select auth.uid())) and provider <> 'arpege');

-- USING et WITH CHECK : ni modifier une ligne Arpège, ni en fabriquer une en
-- renommant le provider d'une autre.
create policy integrations_superadmin_update on public.organization_integrations
  for update to authenticated
  using (public.is_superadmin((select auth.uid())) and provider <> 'arpege')
  with check (public.is_superadmin((select auth.uid())) and provider <> 'arpege');

create policy integrations_superadmin_delete on public.organization_integrations
  for delete to authenticated
  using (public.is_superadmin((select auth.uid())) and provider <> 'arpege');

-- Suspend la ligne Arpège RECOPIÉE d'un tenant (le Socle n'en déclare plus de
-- complète). Identifiants conservés. Renvoie true si l'interface était active
-- (elle vient donc d'être suspendue) — c'est ce que compte `arpege_suspendu`.
-- `socle_synced_at` est rafraîchi : la ligne a bien été relue au Socle.
create or replace function public.suspend_arpege_integration_from_socle(
  p_org_id uuid
) returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_was_active boolean;
begin
  select is_active into v_was_active
    from public.organization_integrations
   where organization_id = p_org_id
     and provider = 'arpege'
     and socle_synced_at is not null
   for update;

  if not found then
    return false;
  end if;

  update public.organization_integrations
     set is_active       = false,
         socle_synced_at = now()
   where organization_id = p_org_id
     and provider = 'arpege';

  return coalesce(v_was_active, false);
end;
$function$;

revoke all on function public.suspend_arpege_integration_from_socle(uuid)
  from public, anon, authenticated;
grant execute on function public.suspend_arpege_integration_from_socle(uuid)
  to service_role;
