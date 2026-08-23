-- ============================================================================
-- Le serveur d'envoi vient du Socle : vérification en base.
--
-- Un seul bloc DO, qui crée son décor, éprouve les invariants, puis se termine
-- TOUJOURS par une exception : la transaction implicite est annulée et la base
-- retrouve son état d'avant (aucune organisation ni ligne SMTP de test ne
-- survit). Le message de l'exception EST le verdict.
--
-- À rejouer après toute migration touchant smtp_settings ou ses RPC :
--   psql "$SUPABASE_DB_URL" -f supabase/tests/smtp_socle.test.sql
-- ou en collant ce fichier dans l'éditeur SQL / execute_sql du projet.
--
-- Douze scénarios : étanchéité cliente (1-4), écriture de service (5-8),
-- refus d'un relais bancal (9-10), effacement (11) et cloisonnement
-- multi-tenant (12).
-- ============================================================================

do $$
declare
  c_sync constant text :=
    'public.sync_smtp_settings_from_socle(uuid,uuid,text,integer,text,text,text,text,boolean,timestamptz)';
  c_clear constant text := 'public.clear_smtp_settings_from_socle(uuid)';

  v_racine  constant uuid := gen_random_uuid();  -- racine Socle fictive
  v_racine2 constant uuid := gen_random_uuid();

  v_org_a uuid;
  v_org_b uuid;
  v_echecs text[] := '{}';
  v_row    public.smtp_settings%rowtype;
  v_row_b  public.smtp_settings%rowtype;
  v_sync1  timestamptz;
  v_bool   boolean;
  v_count  integer;
begin
  -- ── Décor : deux tenants, aucun relais ────────────────────────────────────
  insert into public.organizations (name, slug)
    values ('[TEST SQL] Alpha', 'test-sql-alpha-' || gen_random_uuid())
    returning id into v_org_a;
  insert into public.organizations (name, slug)
    values ('[TEST SQL] Beta', 'test-sql-beta-' || gen_random_uuid())
    returning id into v_org_b;

  -- ── 1-2. Plus aucune écriture ni lecture cliente sur la table ─────────────
  if has_table_privilege('authenticated', 'public.smtp_settings', 'select')
     or has_table_privilege('authenticated', 'public.smtp_settings', 'insert')
     or has_table_privilege('authenticated', 'public.smtp_settings', 'update')
     or has_table_privilege('authenticated', 'public.smtp_settings', 'delete') then
    v_echecs := v_echecs || '1. authenticated a encore un droit sur smtp_settings';
  end if;
  if has_table_privilege('anon', 'public.smtp_settings', 'select')
     or has_table_privilege('anon', 'public.smtp_settings', 'insert')
     or has_table_privilege('anon', 'public.smtp_settings', 'update')
     or has_table_privilege('anon', 'public.smtp_settings', 'delete') then
    v_echecs := v_echecs || '2. anon a encore un droit sur smtp_settings';
  end if;

  -- ── 3-4. Les RPC de service sont hors de portée d'un client ───────────────
  if has_function_privilege('authenticated', c_sync, 'execute')
     or has_function_privilege('authenticated', c_clear, 'execute') then
    v_echecs := v_echecs || '3. authenticated peut exécuter une RPC de service';
  end if;
  if has_function_privilege('anon', c_sync, 'execute')
     or has_function_privilege('anon', c_clear, 'execute') then
    v_echecs := v_echecs || '4. anon peut exécuter une RPC de service';
  end if;
  if not has_function_privilege('service_role', c_sync, 'execute')
     or not has_function_privilege('service_role', c_clear, 'execute') then
    v_echecs := v_echecs || '4bis. service_role ne peut plus synchroniser';
  end if;

  -- ── 5. Création du miroir : provenance, fraîcheur, normalisation ──────────
  perform public.sync_smtp_settings_from_socle(
    v_org_a, v_racine, '  smtp.test  ', 587, '  identifiant  ', 'motdepasse',
    '  Contact@Test.FR  ', '  Mairie  ', true, '2026-07-11T11:42:08Z'::timestamptz);

  select * into v_row from public.smtp_settings where organization_id = v_org_a;
  if v_row.host <> 'smtp.test' then
    v_echecs := v_echecs || ('5. hôte non élagué : ' || coalesce(v_row.host, '<null>'));
  end if;
  if v_row.from_email <> 'contact@test.fr' then
    v_echecs := v_echecs || ('5. adresse non normalisée : ' || coalesce(v_row.from_email, '<null>'));
  end if;
  if v_row.username <> 'identifiant' or v_row.from_name <> 'Mairie' then
    v_echecs := v_echecs || '5. identifiant ou nom non élagué';
  end if;
  if v_row.socle_org_id is distinct from v_racine then
    v_echecs := v_echecs || '5. provenance (socle_org_id) absente';
  end if;
  if v_row.socle_updated_at is null or v_row.synced_at is null then
    v_echecs := v_echecs || '5. fraîcheur (socle_updated_at / synced_at) absente';
  end if;
  v_sync1 := v_row.synced_at;

  -- ── 6. Miroir strict : le mot de passe retiré côté Socle est retiré ici ───
  perform public.sync_smtp_settings_from_socle(
    v_org_a, v_racine, 'smtp.test', 587, 'identifiant', '',
    'contact@test.fr', 'Mairie', true, '2026-07-12T09:00:00Z'::timestamptz);

  select * into v_row from public.smtp_settings where organization_id = v_org_a;
  if v_row.password <> '' then
    v_echecs := v_echecs || '6. mot de passe retiré côté Socle mais conservé dans le miroir';
  end if;
  if v_row.synced_at < v_sync1 then
    v_echecs := v_echecs || '6. synced_at recule';
  end if;

  select count(*) into v_count from public.smtp_settings where organization_id = v_org_a;
  if v_count <> 1 then
    v_echecs := v_echecs || ('6. ' || v_count || ' lignes pour un tenant (unicité rompue)');
  end if;

  -- ── 7. Port aberrant : repli sur 587, jamais d'écriture bancale ───────────
  perform public.sync_smtp_settings_from_socle(
    v_org_a, v_racine, 'smtp.test', 99999, '', 'x',
    'contact@test.fr', '', true, null);
  select * into v_row from public.smtp_settings where organization_id = v_org_a;
  if v_row.port <> 587 then
    v_echecs := v_echecs || ('7. port aberrant conservé : ' || v_row.port);
  end if;

  -- ── 8. use_tls absent ⇒ chiffrement (jamais de repli silencieux en clair) ──
  perform public.sync_smtp_settings_from_socle(
    v_org_a, v_racine, 'smtp.test', 587, '', 'x',
    'contact@test.fr', '', null, null);
  select * into v_row from public.smtp_settings where organization_id = v_org_a;
  if v_row.use_tls is not true then
    v_echecs := v_echecs || '8. use_tls absent n''a pas basculé sur true';
  end if;

  -- ── 9. Refus d'un hôte vide, et le miroir reste intact ────────────────────
  begin
    perform public.sync_smtp_settings_from_socle(
      v_org_a, v_racine, '   ', 587, '', 'x', 'contact@test.fr', '', true, null);
    v_echecs := v_echecs || '9. hôte vide accepté';
  exception when sqlstate '22023' then
    null;  -- refus attendu
  end;
  select * into v_row from public.smtp_settings where organization_id = v_org_a;
  if v_row.host <> 'smtp.test' then
    v_echecs := v_echecs || '9. le refus a tout de même touché le miroir';
  end if;

  -- ── 10. Refus d'une adresse d'expédition vide ─────────────────────────────
  begin
    perform public.sync_smtp_settings_from_socle(
      v_org_b, v_racine2, 'smtp.test', 587, '', 'x', '  ', '', true, null);
    v_echecs := v_echecs || '10. adresse d''expédition vide acceptée';
  exception when sqlstate '22023' then
    null;
  end;
  if exists (select 1 from public.smtp_settings where organization_id = v_org_b) then
    v_echecs := v_echecs || '10. un relais bancal a été écrit malgré le refus';
  end if;

  -- ── 11. Effacement : vrai la première fois, faux ensuite ──────────────────
  select public.clear_smtp_settings_from_socle(v_org_a) into v_bool;
  if v_bool is not true then
    v_echecs := v_echecs || '11. l''effacement ne signale pas la ligne retirée';
  end if;
  if exists (select 1 from public.smtp_settings where organization_id = v_org_a) then
    v_echecs := v_echecs || '11. la ligne survit à son effacement';
  end if;
  select public.clear_smtp_settings_from_socle(v_org_a) into v_bool;
  if v_bool is not false then
    v_echecs := v_echecs || '11. l''effacement d''un tenant sans relais renvoie vrai';
  end if;

  -- ── 12. Étanchéité entre organisations ────────────────────────────────────
  perform public.sync_smtp_settings_from_socle(
    v_org_a, v_racine, 'a.test', 587, 'ua', 'pa', 'a@test.fr', 'A', true, null);
  perform public.sync_smtp_settings_from_socle(
    v_org_b, v_racine2, 'b.test', 465, 'ub', 'pb', 'b@test.fr', 'B', false, null);

  select * into v_row   from public.smtp_settings where organization_id = v_org_a;
  select * into v_row_b from public.smtp_settings where organization_id = v_org_b;
  if v_row.host <> 'a.test' or v_row_b.host <> 'b.test'
     or v_row_b.port <> 465 or v_row_b.use_tls is not false
     or v_row_b.socle_org_id is distinct from v_racine2 then
    v_echecs := v_echecs || '12. une écriture a débordé sur l''autre organisation';
  end if;

  perform public.clear_smtp_settings_from_socle(v_org_a);
  if not exists (select 1 from public.smtp_settings where organization_id = v_org_b) then
    v_echecs := v_echecs || '12. l''effacement d''un tenant a emporté le relais d''un autre';
  end if;

  -- ── Verdict (et annulation de tout ce qui précède) ────────────────────────
  if array_length(v_echecs, 1) is null then
    raise exception 'VERDICT SMTP←SOCLE : 12/12 scénarios OK — transaction annulée.';
  else
    raise exception 'VERDICT SMTP←SOCLE : % ÉCHEC(S) -> %',
      array_length(v_echecs, 1), array_to_string(v_echecs, ' | ');
  end if;
end
$$;
